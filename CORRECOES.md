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

## Verificação

Rodados nesta máquina:

```
npm run typecheck   # sem erros
npm run test        # 27 testes, 4 arquivos
npm run build       # 20 rotas de API + 6 páginas
```

**Não verificado:** qualquer coisa que exija banco (nem PostgreSQL nem Docker
disponíveis aqui) e o serviço Java (sem JDK). O caminho de dados precisa de um
teste contra o banco real depois do primeiro deploy — começando por
`GET /api/health`.
