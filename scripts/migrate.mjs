#!/usr/bin/env node
/**
 * Aplica db/migrations/*.sql em ordem, uma vez cada, registrando o que já rodou
 * em `schema_migrations`. Cada arquivo roda dentro de uma transação: se falhar
 * no meio, nada daquele arquivo fica aplicado.
 *
 *   DATABASE_URL="postgresql://..." npm run db:migrate
 */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'db', 'migrations');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL não definida.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: (process.env.DATABASE_SSL ?? 'true') === 'true' ? { rejectUnauthorized: false } : false
});

await client.connect();
await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

const applied = new Map(
  (await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map((row) => [
    row.filename,
    row.checksum
  ])
);

const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
let ran = 0;

for (const filename of files) {
  const sql = await readFile(join(migrationsDir, filename), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 16);
  const previous = applied.get(filename);

  if (previous) {
    if (previous !== checksum) {
      console.warn(`! ${filename} já aplicada, mas o conteúdo mudou. Crie uma nova migração.`);
    } else {
      console.log(`= ${filename} (já aplicada)`);
    }
    continue;
  }

  process.stdout.write(`+ ${filename} ... `);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
      filename,
      checksum
    ]);
    await client.query('COMMIT');
    console.log('ok');
    ran += 1;
  } catch (error) {
    await client.query('ROLLBACK');
    console.log('FALHOU');
    console.error(error.message);
    await client.end();
    process.exit(1);
  }
}

console.log(ran ? `\n${ran} migração(ões) aplicada(s).` : '\nBanco já está atualizado.');
await client.end();
