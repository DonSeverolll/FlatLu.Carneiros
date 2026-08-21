# Correções aplicadas

Registro do que estava quebrado e do que passou a valer. Cada item aponta onde
verificar.

## 1. Serviço Java autenticava contra o usuário errado

`SecurityConfig` usava `httpBasic()` sem nenhum `UserDetailsService`, então o
Spring Boot autenticava contra o usuário em memória gerado no boot — nunca
contra a tabela `users`. Consequências: `/auth/me` estourava `500` no
`orElseThrow()` e `hasRole("ADMIN")` era inalcançável, porque nenhuma authority
vinha do banco.

Agora existe `UsuarioDetailsService` ligado por `DaoAuthenticationProvider`, e a
entidade conhece `status`/`deleted_at` para recusar suspenso e excluído.

**Não foi compilado** — não há JDK nesta máquina. Detalhes em
[apps/auth-service/README.md](apps/auth-service/README.md).

## 2. Não existia forma de pagar

O webhook estava bem feito, mas nenhuma rota criava cobrança: a reserva nascia
`PENDING_PAYMENT` e morria no hold sem que o hóspede pudesse pagar.

- `POST /api/reservations/:id/payment-intent` gera a cobrança do sinal e devolve
  um **Pix copia-e-cola** (BR Code EMV do Banco Central) com valor e
  identificador fixos, além de `GET .../pix-qr` com o QR em SVG.
- `POST /api/admin/reservations/:id/confirm-payment` faz a conciliação manual,
  pela mesma trilha de auditoria e transições de estado do webhook.
- Página `/reserva/[id]` com QR, copia-e-cola, valores e contagem do hold.
- A cobrança é idempotente: o índice `payments_one_pending_per_reservation`
  garante uma pendência por reserva, então recarregar a página devolve o mesmo
  Pix e a mesma referência.

O gerador de BR Code é testado, inclusive contra o vetor de verificação do
CRC-16/CCITT-FALSE (`src/server/pix.test.ts`).

## 3. Diária zerada e sinal fixo no front-end

O seed gravava `nightly_rate = 0`, então todo orçamento saía `R$ 0,00`, e o
front tinha "Sinal de 50%" escrito no código em vez de usar
`deposit_percentage` da API.

Nenhum preço foi inventado. Enquanto a diária for `0`, a vitrine mostra
**"Tarifa sob consulta"** e a API recusa a reserva com `RATE_NOT_PUBLISHED` —
preço errado não vai ao ar. O sinal agora sai de `deposit_percentage`, e
`PATCH /api/admin/properties/:id` publica diária, sinal e chave Pix sem abrir o
SQL Editor.

Cálculo migrado para centavos inteiros: `199,99 × 7` dava
`1399.9299999999998` em float e divergia do que o banco gravava.

Depois disso a diária única deu lugar a um **calendário de tarifas** (preço por
dia da semana, períodos especiais, pacotes fechados e estadia mínima por dia de
chegada). Ver [README](README.md#calendário-de-tarifas).

## 4. Pagamento parcial expirava a reserva

Com `PARTIAL`, a reserva seguia em `PENDING_PAYMENT` sem estender `expires_at` —
o varredor de 60s marcava `EXPIRED` e liberava a data de quem já havia pagado o
sinal.

Duas travas: o varredor só considera `payment_status = 'PENDING'`, e um
pagamento parcial estende o hold. Coberto por teste
(`src/server/payment.test.ts`).

## 5. Sessão de 15 minutos sem renovação

O JWT e o cookie expiravam em 15 minutos e não havia rota de refresh: o hóspede
era deslogado no meio da reserva.

Access token de 15 min + refresh token de 30 dias em `user_sessions`, guardado
como SHA-256, revogável, **rotativo a cada uso** e com detecção de reuso — um
token já usado que reaparece derruba todas as sessões daquele usuário. O cliente
HTTP renova sozinho no primeiro `401` e repete a requisição.

## 6. `sameSite: 'lax'` era uma armadilha de deploy

Funcionava em `localhost:3000 → :4000` por serem o mesmo site, mas web e API em
domínios diferentes (Vercel + Render, por exemplo) fariam o cookie deixar de ser
enviado e o login parar sem erro visível.

A API virou Route Handlers do Next.js no mesmo projeto: **mesma origem, um
domínio**. O cliente usa caminhos relativos (`/api/...`), sem CORS.

## 7. Ajustes menores

- **Vazamento de informação:** `/availability` devolvia o `source` do bloqueio,
  expondo `MAINTENANCE` e `OWNER_USE`. Agora devolve só as noites indisponíveis.
- **Fuso:** datas de estadia eram `Date.toISOString()` castado para `::date`, o
  que fazia o resultado depender do `TimeZone` da sessão do banco. Passaram a
  ser strings `YYYY-MM-DD` de ponta a ponta.
- **Disponibilidade correta:** uma noite é indisponível quando a janela real
  `[dia + check-in, dia+1 + check-out + faxina)` colide com um bloqueio. O
  cálculo saiu do navegador para o banco.
- **CSRF:** toda rota que altera estado exige `Origin` igual ao host que
  atendeu (webhook exceptuado — tem segredo próprio, comparado em tempo
  constante).
- **Força bruta:** throttle de login e cadastro com estado em `auth_attempts`.
  Contador em memória não serve em serverless: cada invocação pode rodar em
  instância diferente.
- **E-mail duplicado no cadastro** devolvia `500`; agora `409
  EMAIL_ALREADY_REGISTERED`.
- **Faltava tela de cadastro:** `/api/auth/register` existia sem UI — só era
  possível criar conta por `curl`.
- **Regras de negócio** saíram do código: `min_nights`, `max_guests`,
  `hold_minutes`, `booking_horizon_days` viraram colunas (`guestCount` tinha
  `max(8)` fixo, contra capacidade real de 4).
- **Cabeçalhos de segurança:** HSTS, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Testes e CI:** 27 testes de unidade sobre a lógica pura (datas, dinheiro,
  Pix, transição de status) e GitHub Actions com typecheck, testes e build.
- **Migrações versionadas:** `npm run db:migrate` aplica em ordem, uma vez cada,
  cada arquivo em sua transação.

## Reestruturação

`apps/api` (Fastify) foi absorvido por `apps/web`. Fastify é um processo
residente e o `setInterval` do varredor de holds não sobrevive em serverless —
não roda no Vercel. A lógica e o SQL foram para `apps/web/src/server/`; o código
antigo continua no histórico do git.

O varredor de holds virou preguiçoso: roda em toda consulta de disponibilidade e
dentro da transação de criação de reserva. É isso que garante correção sem
processo residente — o cron diário é só limpeza (sessões vencidas, tentativas
antigas, cobranças órfãs).

## Merge com o commit `Flat Up; 1.0`

Enquanto a reestruturação acontecia, um commit chegou ao remoto com login por
usuário, painel `/admin` e provisionamento de dois administradores. Nada foi
descartado — tudo foi portado para a nova arquitetura:

- **Login por identidade.** `identifier` aceita e-mail (hóspedes) ou usuário
  (administradores); `email` continua aceito para não quebrar cliente antigo. O
  throttle passou a ser por identidade, não por e-mail.
- **Painel `/admin`.** Reescrito sobre o cliente de mesma origem e ampliado com
  o que passou a existir: confirmar sinal ou pagamento integral, cancelar com
  motivo e reembolso opcional, publicar diária/sinal/chave Pix e bloquear
  períodos. Um aviso no topo diz o que falta configurar.
- **`scripts/seed-admins.mjs`.** Portado de `tsx` para Node puro com
  `@node-rs/argon2`, com validação do formato de usuário antes de bater na
  constraint e revogação das sessões abertas quando a senha muda.
- **Migração renumerada.** `002_admin_usernames.sql` (deles) ficou como 002; o
  endurecimento virou `003_hardening.sql`. Havia colisão de número.
- **`.vscode/tasks.json`** atualizado: as tarefas `dev:api`/`dev:web` deixaram
  de existir com a consolidação.

## Bugs encontrados só ao rodar contra o banco

Com o Supabase configurado, um teste ponta a ponta (`npm run db:smoke`)
encontrou três defeitos que **passaram** por typecheck, testes de unidade e
build. Dois deles vinham do código original e nunca haviam aparecido porque
nada havia sido executado contra um PostgreSQL.

**1. `ON CONFLICT` não inferia índice parcial** (`42P10`) — herdado do original.
`reservations_idempotency_unique` e `payments_provider_transaction_unique` são
índices parciais (`WHERE ... IS NOT NULL`), e o PostgreSQL só os aceita como
árbitro se o `ON CONFLICT` repetir o mesmo predicado. Sem isso, **toda criação
de reserva devolvia 500** — o fluxo principal do site estava inteiramente
quebrado.

**2. Parâmetro com dois tipos na mesma query** (`42P08`) — herdado do original.
`$2` era usado como `payment_status` em `SET status = $2` e como texto em
`CASE WHEN $2 IN ('PAID','PARTIAL')`; o planejador não reconcilia
`text versus payment_status`. Derrubava toda confirmação de pagamento. Resolvido
com cast explícito nas duas ocorrências.

**3. Rotação de refresh token apagava a prova de reuso** — introduzido na
correção da falha 5. A rotação sobrescrevia `refresh_token_hash` na mesma linha,
então um token vazado reapresentado depois caía em "não encontrado" em vez de
"reutilizado": a detecção de reuso simplesmente não funcionava. Agora a linha
antiga é revogada como `ROTATED` e uma nova é criada.

O mesmo teste expôs um efeito colateral da rotação estrita: duas abas renovando
no mesmo instante apresentam o mesmo token e derrubariam todas as sessões do
usuário. Dentro de 10 segundos da rotação legítima isso é tratado como corrida
(`REFRESH_RACE`, sem revogação em massa); fora da janela, é replay.

## Verificação

```
npm run typecheck   # sem erros
npm run test        # 27 testes de unidade
npm run build       # 21 rotas de API + 7 páginas
npm run db:smoke    # 48 verificações contra o Supabase real
```

O teste de fumaça cobre: cadastro e login (por e-mail e por usuário), guarda de
tarifa não publicada, estadia mínima, capacidade, data no passado, criação de
reserva com valores conferidos em centavos, idempotência por chave, recusa de
datas sobrepostas, aceite de estadia encostada no check-out, cobrança Pix com
CRC validado, QR em SVG, pagamento parcial que não expira, confirmação total,
rotação e reuso de refresh token, autorização de CUSTOMER contra rotas de admin,
trilha de auditoria e liberação de data no cancelamento.

**Não verificado:** o serviço Java (sem JDK nesta máquina) e o comportamento sob
o pooler em modo transação do Vercel — as migrações e o teste de fumaça rodaram
pelo modo sessão (porta 5432).
