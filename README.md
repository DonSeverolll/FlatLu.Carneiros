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

Segurança e consistência não são negociáveis: o front-end nunca decide disponibilidade, preço ou permissão.
