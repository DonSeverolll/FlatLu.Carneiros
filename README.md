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

## Teste de fumaça

`npm run test` cobre a lógica pura. O que só quebra com um banco do outro lado
(inferência de índice parcial, tipo de parâmetro em enum, rotação de sessão)
precisa do teste de fumaça:

```bash
BASE=http://localhost:3000 SMOKE_CONFIRM=1 npm run db:smoke
```

São 48 verificações do fluxo inteiro. Ele cria usuários `e2e-*@teste.local`,
faz reservas e **altera a diária e a chave Pix da propriedade**, restaurando
tudo no final — por isso a confirmação explícita. Não rode contra produção em
horário de venda.

## Notas de infraestrutura

- A connection string **direta** do Supabase (`db.<ref>.supabase.co`) é
  IPv6-only. Em rede sem IPv6 ela nem resolve; use sempre o pooler.
- Pooler em **modo transação** (6543) para a aplicação; **modo sessão** (5432)
  para DDL. O `db:migrate` troca a porta sozinho quando detecta a 6543.
