# Carneiros Flat Booking

Sistema de reservas para uma propriedade única — vitrine, calendário com
disponibilidade real, reserva com hold, sinal por Pix e área do hóspede.

**Princípio que organiza o código:** o front-end nunca decide disponibilidade,
preço ou permissão. Quem garante que duas reservas não ocupam a mesma noite é o
PostgreSQL, com uma constraint de exclusão — não um `if` na aplicação.

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
DATABASE_URL="postgresql://app:app@localhost:5432/carneiros_flat" DATABASE_SSL=false npm run db:migrate
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

2. **Migrações.**
   ```bash
   DATABASE_URL="postgresql://..." npm run db:migrate
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
   | `PROPERTY_SLUG` | não | padrão `flat-praia-de-carneiros` |

   Cada segredo é validado apenas na rota que o usa. Faltando
   `PAYMENT_WEBHOOK_SECRET`, o webhook responde `503` — o resto do site
   continua no ar.

5. **Deploy.** O `apps/web/vercel.json` registra o cron diário em
   `/api/cron/release-holds`.

## Depois do primeiro deploy

Nada é inventado pelo sistema: enquanto a diária for `0`, a vitrine mostra
"Tarifa sob consulta" e a API recusa criar reserva com `RATE_NOT_PUBLISHED`.
Preço errado nunca vai ao ar.

1. Crie sua conta em `/cadastro` e promova-se a administrador:
   ```bash
   DATABASE_URL="postgresql://..." node scripts/promote-admin.mjs voce@email.com
   ```

2. Publique diária, sinal e chave Pix (`PATCH /api/admin/properties/:id`,
   autenticado como ADMIN):
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
