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

/**
 * DDL pede modo sessao. O pooler do Supabase serve modo transacao na 6543 e
 * modo sessao na 5432 -- se a URL vier apontada para a 6543, migramos pela
 * 5432 do mesmo host em vez de arriscar comportamento estranho de pgbouncer.
 */
function sessionModeUrl(url) {
  // Comparar host e porta de verdade, em vez de procurar a substring na URL
  // inteira: o texto ".pooler.supabase.com:6543" poderia aparecer na senha ou
  // num parâmetro e o replace corromperia a string de conexão.
  let alvo;
  try {
    alvo = new URL(url);
  } catch {
    return url;
  }
  const ehPooler = alvo.hostname === 'pooler.supabase.com'
    || alvo.hostname.endsWith('.pooler.supabase.com');
  if (!ehPooler || alvo.port !== '6543') return url;

  alvo.port = '5432';
  console.log('Pooler em modo transacao detectado; migrando pela porta 5432 (modo sessao).');
  return alvo.toString();
}

const client = new pg.Client({
  connectionString: sessionModeUrl(databaseUrl),
  ssl: (process.env.DATABASE_SSL ?? 'true') === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 20_000
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

/*
 * Toda tabela do schema public precisa de RLS (ver 015): no Supabase, tabela
 * sem RLS fica legível pela chave `anon`, que é pública. O aviso existe para
 * que uma migração nova que esqueça o ENABLE ROW LEVEL SECURITY seja vista no
 * mesmo dia, e não por quem estiver varrendo a Data API.
 */
const semRls = await client.query(
  `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    ORDER BY 1`
);
if (semRls.rowCount) {
  console.warn(
    `\n! ${semRls.rowCount} tabela(s) sem Row Level Security: ` +
      semRls.rows.map((row) => row.relname).join(', ') +
      '\n  Ligue com ALTER TABLE ... ENABLE ROW LEVEL SECURITY numa nova migração.'
  );
}
await client.end();
