#!/usr/bin/env node
/**
 * Promove um usuário existente a ADMIN. O cadastro público sempre cria
 * CUSTOMER — não existe caminho pela web para virar administrador.
 *
 *   DATABASE_URL="postgresql://..." node scripts/promote-admin.mjs voce@email.com
 */
import pg from 'pg';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Uso: node scripts/promote-admin.mjs <email>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL ?? 'true') === 'true' ? { rejectUnauthorized: false } : false
});
await client.connect();
const result = await client.query(
  `UPDATE users SET role = 'ADMIN', updated_at = now()
   WHERE email = $1 AND deleted_at IS NULL
   RETURNING id, email, role`,
  [email]
);
console.log(result.rowCount ? result.rows[0] : `Nenhum usuário com e-mail ${email}.`);
await client.end();
