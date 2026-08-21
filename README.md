# Carneiros Flat Booking

Sistema modular de reservas para uma propriedade única.

## Estrutura

- `apps/api`: API Fastify, autenticação e regras transacionais.
- `apps/web`: front-end Next.js para vitrine, reservas e área do cliente.
- `apps/api/migrations`: schema PostgreSQL com proteção contra sobreposição.

## Primeiro ambiente

1. Instale Node.js 20+.
2. Execute `npm install` na raiz.
3. Crie um projeto no Supabase e copie a connection string PostgreSQL em `apps/api/.env`.
4. Execute o conteúdo de `apps/api/migrations/001_initial.sql` no SQL Editor do Supabase.
5. Execute `npm run dev:api`.

## Cadastro e administradores

O cadastro de clientes está disponível em `/cadastro` e usa a mesma API e banco PostgreSQL do Supabase. Não é necessário criar um segundo projeto Supabase: configure `DATABASE_URL` com a connection string do projeto principal e aplique as migrations `001_initial.sql` e `002_admin_usernames.sql` no SQL Editor.

O login aceita e-mail para clientes e usuário ou e-mail para administradores. Para provisionar os dois administradores sem armazenar senhas no código:

1. Copie `apps/api/.env.example` para `apps/api/.env`.
2. Preencha `ADMIN_1_EMAIL`, `ADMIN_1_PASSWORD`, `ADMIN_2_EMAIL` e `ADMIN_2_PASSWORD` com valores reais. Os usuários padrão são `LuciaArcoverdeFlt` e `VictorFerrFlt`.
3. Execute `npm --workspace apps/api run seed:admins`.

As senhas são armazenadas somente como hashes Argon2id. Nunca publique o arquivo `.env` nem coloque credenciais em componentes do Next.js.

Segurança e consistência não são negociáveis: o front-end nunca decide disponibilidade, preço ou permissão.
