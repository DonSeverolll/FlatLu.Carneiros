# Apt Carneiros — Flat & Casa

Sistema de reservas para três espaços independentes — vitrine, calendário
mensal com disponibilidade real, reserva com hold, sinal por Pix e área do
hóspede.

| Espaço | Local | Capacidade |
|---|---|---|
| Flat Carneiros | Praia de Carneiros, Tamandaré — PE | 7 |
| Casa Térreo | São José da Coroa Grande — PE | 10 |
| Casa 1º Andar | São José da Coroa Grande — PE | 10 |

Os três são **locais distintos**: alugar um não ocupa outro. Cada um tem
calendário, tarifa, capacidade, chave Pix e cor próprios. A cor identifica o
espaço no calendário, nos cards, na página de pagamento e no painel.

**Horários:** check-in a partir das 09:00 até as 16:00; check-out
impreterivelmente até as 16:00.

**Princípio que organiza o código:** o front-end nunca decide disponibilidade,
preço ou permissão. Quem garante que duas reservas não ocupam a mesma noite é o
PostgreSQL, com uma constraint de exclusão — não um `if` na aplicação. Como a
constraint é chaveada por `property_id`, ela protege cada espaço separadamente,
que é exatamente o comportamento desejado para locais independentes.

## Estrutura

```
apps/web/            Aplicação Next.js 15 — vitrine + API (Route Handlers)
  app/               Páginas e rotas /api/*
  src/server/        Camada de servidor: banco, sessão, reservas, pagamento
  src/lib/           Cliente HTTP, tipos e formatação do front-end
db/migrations/       Schema PostgreSQL, aplicado em ordem
scripts/             Migração e promoção de administrador
apps/auth-service/   Spring Boot opcional, fora do deploy (ver README próprio)
```

Vitrine e API vivem no **mesmo domínio**, de propósito: o cookie de sessão viaja
sem `SameSite=None` e sem CORS. Uma API em domínio separado quebraria o login
silenciosamente no primeiro deploy em produção.

## Rodar localmente

```bash
npm install
docker compose up -d          # PostgreSQL 16 + extensão btree_gist
cp apps/web/.env.example apps/web/.env.local
```

Ajuste `apps/web/.env.local`:

```
DATABASE_URL=postgresql://app:app@localhost:5432/carneiros_flat
DATABASE_SSL=false
JWT_SECRET=<48 caracteres aleatórios>
```

```bash
npm run db:migrate
npm run dev
```

O `docker compose` já aplica as migrações na primeira subida do volume; o
`db:migrate` é para bancos existentes (Supabase, Neon) e é idempotente.

## Deploy no Vercel

O projeto é um só. Não há serviço de API separado para hospedar.

1. **Banco.** Crie um projeto PostgreSQL no [Supabase](https://supabase.com) ou
   [Neon](https://neon.tech). Copie a connection string do **pooler**
   (Supabase: porta `6543`) — serverless abre e fecha conexões o tempo todo e a
   porta direta esgota o limite.

2. **Migrações.** Preencha `DATABASE_URL` em `apps/web/.env.local` (ignorado
   pelo git) e rode — os scripts de banco leem esse arquivo sozinhos:
   ```bash
   npm run db:migrate
   ```

3. **Projeto no Vercel.** Importe o repositório e defina
   **Root Directory = `apps/web`**. O framework é detectado como Next.js.

4. **Variáveis de ambiente** (Production e Preview):

   | Variável | Obrigatória | Observação |
   |---|---|---|
   | `DATABASE_URL` | sim | connection string do pooler |
   | `DATABASE_SSL` | sim | `true` |
   | `JWT_SECRET` | sim | mínimo 32 caracteres — `openssl rand -base64 48` |
   | `CRON_SECRET` | sim | segredo do cron diário de limpeza |
   | `PAYMENT_WEBHOOK_SECRET` | não | só ao integrar um provedor de pagamento |

   Cada segredo é validado apenas na rota que o usa. Faltando
   `PAYMENT_WEBHOOK_SECRET`, o webhook responde `503` — o resto do site
   continua no ar.

5. **Deploy.** O `apps/web/vercel.json` registra o cron diário em
   `/api/cron/release-holds`.

## Depois do primeiro deploy

Nada é inventado pelo sistema: enquanto a diária for `0`, a vitrine mostra
"Tarifa sob consulta" e a API recusa criar reserva com `RATE_NOT_PUBLISHED`.
Preço errado nunca vai ao ar.

1. Crie sua conta em `/cadastro` e promova-se a administrador (ou use
   `npm run seed:admins`):
   ```bash
   DATABASE_URL="postgresql://..." node scripts/promote-admin.mjs voce@email.com
   ```

2. Entre em `/login` e publique diária, sinal e chave Pix pelo painel
   `/admin`. Pela API, se preferir (`PATCH /api/admin/properties/:id`):
   ```bash
   curl -X PATCH "https://SEU-DOMINIO/api/admin/properties/$PROPERTY_ID" \
     -H 'Content-Type: application/json' \
     -H "Origin: https://SEU-DOMINIO" \
     -b "session=$SESSION_COOKIE" \
     -d '{"nightlyRate":650,"depositPercentage":50,"minNights":2,"maxGuests":4,
          "pixKey":"sua-chave@pix","pixHolderName":"NOME DO FAVORECIDO",
          "paymentInstructions":"Envie o comprovante pelo WhatsApp."}'
   ```

O `Origin` é obrigatório em toda rota que altera estado — é a defesa CSRF.

## Cadastro e administradores

O cadastro de hóspedes fica em `/cadastro` e usa o mesmo banco. O login aceita
**e-mail ou usuário** (`identifier`): hóspedes entram pelo e-mail,
administradores pelo usuário. Depois de entrar, ADMIN vai para `/admin` e
hóspede para `/conta`.

Cadastro público sempre cria `CUSTOMER` — não existe caminho pela web para
virar administrador.

### Provisionar os administradores

Preencha no ambiente (nunca no código) e rode:

Coloque os valores em `apps/web/.env.local` (há um bloco pronto em
`.env.example`) e rode:

```bash
npm run seed:admins
```

O script é idempotente: rodar de novo atualiza a senha em vez de duplicar.
Senhas ficam apenas como hash Argon2id, e o mínimo é 12 caracteres.

Para promover uma conta já existente:

```bash
npm run promote:admin voce@email.com
```

## O que foi corrigido

Ver [CORRECOES.md](CORRECOES.md) — inclui o que **não** foi verificado.

## Estoque por noite

O bloqueio de estoque é um intervalo de **noites** (`inventory_blocks.blocked_nights`,
um `DATERANGE`), não um intervalo de relógio. Uma estadia de 04 a 07 ocupa as
noites 04, 05 e 06 — o dia 07 é da saída e continua vendável, então a virada no
mesmo dia funciona.

Isso não era assim antes: o bloqueio ia de `check_in_time` do dia de entrada até
`check_out_time` do dia de saída. Funcionava enquanto a janela cabia em 24 horas
(check-in 15:00 / check-out 11:00 dava exatamente 24h e as noites se encaixavam).
Com check-in às 09:00 e check-out às 16:00 a janela passou a medir 35 horas e
cada estadia invadia as noites vizinhas dos dois lados — uma reserva de 3 noites
tirava 5 do calendário.

Horário de chegada e de saída voltaram a ser o que são: cláusula contratual
exibida ao hóspede, não geometria de disponibilidade. Quem precisar de folga
entre hóspedes usa `cleaning_gap_days`, que estende o bloqueio em dias inteiros
— a unidade em que o estoque realmente é contado. O padrão é `0`, isto é, virada
no mesmo dia liberada.

## Calendário de tarifas

O preço não é uma diária única. Cada noite recebe um valor, e a estadia é a soma
— tudo calculado no servidor (`src/server/rates.ts`), nunca no navegador. A
vitrine mostra exatamente o que `GET /api/properties/:slug/quote` responde, e é
o mesmo cálculo que a reserva grava.

**Precedência de cada noite:** período especial de maior prioridade → tarifa do
dia da semana → diária de fallback da propriedade.

### Tarifa por dia da semana

Configurada em `/admin`, por espaço. Tabela em vigor:

| Dia | Flat | Cada andar da casa |
|---|---|---|
| Domingo a quinta | R$ 300 | R$ 700 |
| Sexta | R$ 400 | R$ 900 |
| Sábado | R$ 1.000 | R$ 1.900 |

Um dia com tarifa **0** não é vendido: a vitrine mostra "sob consulta" e a API
recusa a reserva com `RATE_NOT_PUBLISHED`. Preço errado nunca vai ao ar.

`Mín. noites para entrada` é o que impede vender uma noite solta: se a estadia
começa naquele dia da semana, precisa ter pelo menos N noites.

### Períodos especiais

Natal, Réveillon e feriados prolongados entram como períodos com data, também
em `/admin`. Duas formas de cobrar:

- **Pacote fechado** — valor único pelo bloco inteiro, e a estadia precisa
  cobrir todas as noites do período. É o formato de Réveillon: R$ 2.500 não é
  "por noite", é o pacote. Uma reserva que cubra só parte dele é recusada com
  `PERIOD_REQUIRES_FULL_STAY`.
- **Por noite** — substitui a tarifa do dia da semana dentro do período.

`ends_on` é a **última noite**, não o check-out: um Réveillon de 30/12 a 01/01
tem saída em 02/01.

A **prioridade** resolve sobreposições — maior vence, o que permite Réveillon
(prioridade 200) dentro de Alta Estação (100). Dois períodos ativos de mesma
prioridade não podem se sobrepor: a constraint de exclusão do banco recusa, em
vez de escolher um preço em silêncio.

Toda reserva guarda o extrato do cálculo em `reservations.rate_breakdown`, então
uma reserva antiga continua explicável depois que a tabela mudar.

## Painel administrativo

`/admin`, com sidebar (Atendimento e Marketing estão descritos na seção seguinte):

| Seção | O que faz |
|---|---|
| **Menu** | Tarifas, sinal, chave Pix, capacidade e bloqueios, por espaço |
| **Dashboard** | Recebido, a receber, ocupação, diária média, conversão, série temporal e o que exige ação |
| **CRM** | Funil por estágio, próxima ação com data, histórico de contatos |
| **Clientes** | Busca, estadias, pagamentos, total pago, ficha completa e anotações |
| **Agenda** | Chegadas e saídas, observação interna, pedido do hóspede, registro de check-in/out |
| **Usuários** | Papel, situação, edição de cadastro e redefinição de senha |

O CRM é alimentado sozinho: reserva feita no site abre um card, e o estágio
acompanha o que aconteceu de fato (contrato assinado → Negociando; sinal pago →
Fechado; hold expirado → Perdido). Funil mantido à mão mente em duas semanas.

Sobre os gráficos: dinheiro e contagem nunca dividem um eixo — são gráficos
separados. A comparação entre espaços é tabela com barra, não gráfico
categórico: as cores das unidades reprovaram na validação de paleta (escuras e
dessaturadas demais para servirem de marca de gráfico), então a identidade fica
no rótulo e a cor só reforça.

## Atendimento e marketing (Meta)

Duas seções novas no painel, ambas em [`014_meta_e_atendimento.sql`](db/migrations/014_meta_e_atendimento.sql):

| Seção | O que faz |
|---|---|
| **Atendimento** | Inbox único de WhatsApp e Instagram Direct: conversas à esquerda, chat ao centro, lead/origem/reserva à direita |
| **Marketing** | Gasto por anúncio (Meta) cruzado com leads, reservas e dinheiro recebido (nosso banco) |

### Atribuição

Quem chega ao site com `utm_*`, `fbclid`, `gclid`, `ad_id`, `adset_id` ou
`campaign_id` na URL gera um toque em `marketing_touches`, ligado a um cookie
`httpOnly` de primeira parte. Na reserva, o card do CRM recebe o primeiro e o
último toque dos últimos 90 dias e as colunas de origem (`origem_canal`,
`ad_id`, `utm_campaign`...). No cadastro, os toques anônimos passam a apontar
para a conta. Não guardamos IP nem user-agent.

Conversa que nasce de anúncio click-to-WhatsApp ou click-to-Direct traz o
`ad_id` no próprio webhook, e o lead já nasce atribuído.

Nos anúncios, use em **Parâmetros de URL**:

```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&ad_id={{ad.id}}&adset_id={{adset.id}}&campaign_id={{campaign.id}}
```

### WhatsApp

| `WHATSAPP_PROVIDER` | Comportamento |
|---|---|
| vazio | envio recusado com `MESSAGING_NOT_CONFIGURED` |
| `simulado` | grava como enviada e libera o simulador no painel (contato novo, resposta, entregue/lida/falhou) |
| `meta` | envia pela WhatsApp Cloud API |

O simulador monta payloads no formato da Cloud API e os passa pelo mesmo
caminho do webhook real — o que ele testa é o que vai para produção.

Webhooks (mesmo app da Meta, mesmo `META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN`):

- `https://SEU-DOMINIO/api/webhooks/whatsapp` — campo `messages`
- `https://SEU-DOMINIO/api/webhooks/instagram` — campos `messages`, `messaging_seen`

Regras que a tela já aplica: janela de 24h (fora dela só modelo aprovado no
WhatsApp), status que só avança (lida não volta para entregue) e webhook
idempotente pelo id da mensagem. Anexo pelo painel vai até 4 MB (limite do
corpo no Vercel); vídeo do flat vai por URL pública.

### Métricas de anúncios

`POST /api/admin/marketing/sync` (botão "Sincronizar anúncios") e o cron
diário `/api/cron/meta-sync` relêem os últimos 30 dias de insights por
anúncio — a Meta reprocessa atribuição por semanas, então sobrescrever é o
correto. Sem credencial, o cron sai com `skipped`.

### Por que Graph API e não o "Meta MCP"

Um servidor MCP é a interface para um agente de IA consultar a conta. O
backend precisa de chamadas determinísticas, com timeout, paginação e erro
tipado — isso é a Graph API. Os dois leem a mesma conta; ligar o MCP ao Claude
para perguntas ad hoc ("qual anúncio teve o menor CPL?") continua possível.

### RLS

Desde a [`015`](db/migrations/015_rls_em_todas_as_tabelas.sql), **toda** tabela
do schema `public` tem Row Level Security. Antes dela, no Supabase, a Data API
deixava `users`, `user_sessions`, `landlords`, contratos e pagamentos legíveis
para quem tivesse a chave `anon` — que é pública.

- A aplicação não muda: ela conecta como **dona** das tabelas, e o dono não é
  filtrado (não usamos `FORCE ROW LEVEL SECURITY`). Se um dia outro serviço
  conectar com um usuário que não seja o dono — o `auth-service` Java, por
  exemplo —, ele passa a ver zero linhas até ganhar política própria.
- `anon` perdeu todo GRANT; `authenticated` também, exceto nas seis tabelas da
  014, onde só um administrador ativo em `users` (por `auth.uid()`) lê e
  responde. Este sistema não usa o Supabase Auth, então hoje isso não vale para
  ninguém, que é o comportamento seguro.
- Tabela nova criada pelo mesmo usuário já nasce sem GRANT para esses papéis,
  mas a RLS dela tem de ser ligada na própria migração. O `npm run db:migrate`
  avisa no fim quando alguma tabela do `public` ficar sem.

## Configurações e agente de IA

O botão **Configurações**, no rodapé do menu do painel, abre três abas:

| Aba | O que faz |
|---|---|
| **Visão geral** | Tudo de que o site depende — banco, sessão, cron, tarifas, Pix, endereço, contrato, pagamento, integrações, RLS —, com o estado (configurado, falta, opcional) e onde se configura |
| **Integrações** | App da Meta, WhatsApp, Instagram e anúncios: campos, passo a passo, URLs de webhook para copiar e "Testar conexão" |
| **Agente de IA** | Modo, chave da API, modelo, instruções, limites e um teste com pergunta livre |

### Credenciais: painel ou variável de ambiente

Cada campo vale do painel primeiro e da variável de ambiente depois, um a um
— quem já configurou pelo Vercel não perde nada. Tokens digitados no painel
são gravados cifrados (AES-256-GCM, tabela `integracoes`) com a chave em
`INTEGRATIONS_ENCRYPTION_KEY`, que nunca entra no banco. A tela e a API nunca
devolvem um segredo: só se ele existe, de onde vem e os 4 últimos caracteres.
Toda alteração vai para o Log com o nome do campo, nunca o valor.

### Agente de IA

Usa o Claude (`@anthropic-ai/sdk`) com duas ferramentas: consultar
disponibilidade e preço (o mesmo motor de tarifas da reserva — não inventa
valor) e transferir para humano. Não reserva, não cancela, não mexe em
pagamento.

| Modo | Comportamento |
|---|---|
| Desligado | nada |
| Sugerir respostas | botão ✨ no Atendimento escreve um rascunho; o atendente revisa e envia |
| Responder automaticamente | responde sozinho depois do webhook (`after()`), dentro da janela de 24h |

Guardas do modo automático: espera 4 s para juntar mensagens seguidas; não
responde se chegou mensagem mais nova; palavras configuradas (reembolso,
cancelar…) transferem sem chamar o modelo; teto de respostas por conversa;
opção de responder só fora do horário de atendimento. Quando um atendente
responde, o agente pausa naquela conversa (dá para retomar na ficha). Cada
chamada fica em `agente_execucoes`, com resultado e tokens.

O modelo padrão é `claude-opus-5-5` com esforço baixo (conversa rápida). Opus
e Sonnet vão com `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`):
se o classificador de segurança recusar por engano, outro modelo refaz na
mesma chamada. Haiku não tem esse recurso. Uma recusa que persiste não gera
resposta — a conversa fica para a equipe.

O teste da ferramenta de disponibilidade contra um banco real roda à parte:

```bash
E2E_DATABASE_URL=postgresql://... DATABASE_URL=postgresql://... DATABASE_SSL=false npx vitest run src/server/agente/disponibilidade.db.test.ts
```

## Catálogo de fotos (Instagram oficial)

A página inicial mostra uma galeria por espaço (capa em destaque, visualizador
em tela cheia com teclado e vídeo), e a capa do primeiro espaço substitui a
foto genérica do topo. As fotos vêm da conta do Instagram conectada em
Configurações › Integrações, pela API oficial — o token da Página precisa de
`instagram_basic`.

Fluxo em `/admin/catalogo`:

1. **Sincronizar Instagram** lê os posts (carrossel vira uma foto por item) e
   sugere o espaço pela legenda, com as palavras de cada espaço (editáveis ali
   mesmo). Legenda que cita dois espaços, ou nenhum, fica sem sugestão.
2. **✨ Sugerir espaço com IA** (opcional) manda cada foto pendente ao Claude
   junto com até duas fotos já confirmadas de cada espaço, como referência, e
   grava a sugestão e um texto alternativo. Usa a chave e o modelo do Agente
   de IA; até 6 fotos por clique; consome créditos.
3. **Revisão**: nada vai ao site sem um espaço confirmado. Ali se define capa
   (uma por espaço), ordem, visibilidade e texto alternativo.

As URLs de imagem da Meta expiram em dias; o cron diário (`/api/cron/meta-sync`)
sincroniza de novo e as renova. Post apagado no Instagram sai do site na
sincronização seguinte; a revisão feita no painel é mantida.

Nos testes, `META_GRAPH_HOST=http://localhost:PORTA` aponta a Graph API para um
simulador local — só fora de produção.

## Área do hóspede

Depois do cadastro, uma gaveta acessível de qualquer página do site: foto,
Pagamentos, Histórico e Configurações, com sair no rodapé.

- **Pagamentos** — extrato com situação por cobrança: Pendente, Processando,
  Aprovado, Negado, Em atraso e Cancelado. "Em atraso" é derivado do
  vencimento, não gravado: como estado, ficaria errado entre varreduras.
- **Histórico** — estadias passadas e futuras com entrada, saída e situação.
- **Configurações** — perfil, foto, qualificação para o contrato e troca de
  senha.

## Contrato

Depois do aceite dos termos, a reserva segue em três passos: qualificação →
contrato → pagamento. A ordem é a do próprio instrumento, cuja Cláusula Quarta
condiciona a reserva à aprovação da entrada — o servidor recusa cobrança sem
contrato assinado.

O modelo fica em `contract_templates`, versionado, com as partes variáveis como
marcadores. Um marcador sem valor **recusa a emissão**: contrato com "residente
na , /, CEP" é pior que contrato nenhum. O texto é congelado na emissão, então
mudar o modelo depois não altera o que já foi assinado.

A assinatura é **eletrônica simples** (art. 4º, I, da Lei 14.063/2020): nome e
CPF conferidos contra o cadastro, IP, user-agent, instante e hash SHA-256 que
amarra texto, signatário e momento. **Não é ICP-Brasil nem Gov.br** — para esse
nível, exporte o PDF e assine lá; o campo `external_url` do registro existe para
guardar o retorno.

## Pagamento

Pix funciona sem intermediário (BR Code estático com valor e identificador
fixos). Cartão passa pelo Mercado Pago: o adaptador está pronto e só falta a
credencial em `MERCADOPAGO_ACCESS_TOKEN`. Sem ela, a rota recusa com erro
explícito em vez de simular sucesso.

## Teste de fumaça

`npm run test` cobre a lógica pura. O que só quebra com um banco do outro lado
(inferência de índice parcial, tipo de parâmetro em enum, rotação de sessão)
precisa do teste de fumaça:

```bash
BASE=http://localhost:3000 SMOKE_CONFIRM=1 npm run db:smoke
```

São 79 verificações do fluxo inteiro. Ele cria usuários `e2e-*@teste.local`,
faz reservas e **altera a diária e a chave Pix da propriedade**, restaurando
tudo no final — por isso a confirmação explícita. Não rode contra produção em
horário de venda.

## Notas de infraestrutura

- A connection string **direta** do Supabase (`db.<ref>.supabase.co`) é
  IPv6-only. Em rede sem IPv6 ela nem resolve; use sempre o pooler.
- Pooler em **modo transação** (6543) para a aplicação; **modo sessão** (5432)
  para DDL. O `db:migrate` troca a porta sozinho quando detecta a 6543.
