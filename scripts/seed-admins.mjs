#!/usr/bin/env node
/**
 * Provisiona os administradores nomeados. Idempotente: rodar de novo atualiza
 * a senha em vez de duplicar o usuário. Senhas só existem como hash Argon2id e
 * vêm do ambiente — nunca do código.
 *
 *   ADMIN_1_USERNAME=... ADMIN_1_EMAIL=... ADMIN_1_PASSWORD=... \
 *   ADMIN_2_USERNAME=... ADMIN_2_EMAIL=... ADMIN_2_PASSWORD=... \
 *   DATABASE_URL="postgresql://..." npm run seed:admins
 */
import pg from 'pg';
import { hash } from '@node-rs/argon2';

const MIN_PASSWORD = 12;

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Variável ${name} não definida.`);
    process.exit(1);
  }
  return value;
}

/**
 * Provisiona quantos slots estiverem definidos (ADMIN_1_*, ADMIN_2_*, ...).
 * Exigir exatamente dois travava quem ainda so tem o proprio acesso.
 */
const admins = [];
for (let number = 1; number <= 10; number += 1) {
  const username = process.env[`ADMIN_${number}_USERNAME`];
  const email = process.env[`ADMIN_${number}_EMAIL`];
  const password = process.env[`ADMIN_${number}_PASSWORD`];
  if (!username && !email && !password) continue;
  admins.push({
    username: required(`ADMIN_${number}_USERNAME`),
    email: required(`ADMIN_${number}_EMAIL`).trim().toLowerCase(),
    password: required(`ADMIN_${number}_PASSWORD`)
  });
}
if (!admins.length) {
  console.error('Nenhum ADMIN_n_USERNAME/EMAIL/PASSWORD definido.');
  process.exit(1);
}

for (const admin of admins) {
  if (admin.password.length < MIN_PASSWORD) {
    console.error(`Senha de ${admin.username} precisa de ao menos ${MIN_PASSWORD} caracteres.`);
    process.exit(1);
  }
  if (!/^[A-Za-z0-9_]{3,80}$/.test(admin.username)) {
    // Mesma regra da constraint users_username_format: falha aqui é mais
    // legível que um erro de check violation do PostgreSQL.
    console.error(`Usuário ${admin.username} deve ter 3-80 caracteres [A-Za-z0-9_].`);
    process.exit(1);
  }
}

const client = new pg.Client({
  connectionString: required('DATABASE_URL'),
  ssl: (process.env.DATABASE_SSL ?? 'true') === 'true' ? { rejectUnauthorized: false } : false
});

await client.connect();
try {
  for (const admin of admins) {
    const passwordHash = await hash(admin.password);
    const result = await client.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $1, 'ADMIN')
       ON CONFLICT (email) WHERE deleted_at IS NULL
       DO UPDATE SET username = EXCLUDED.username,
                     password_hash = EXCLUDED.password_hash,
                     role = 'ADMIN',
                     status = 'ACTIVE',
                     updated_at = now()
       RETURNING id, username, email, role`,
      [admin.username, admin.email, passwordHash]
    );
    console.log(`${result.rows[0].username} <${result.rows[0].email}> → ADMIN`);
  }
  // Uma senha trocada deve encerrar as sessões abertas daquele usuário.
  await client.query(
    `UPDATE user_sessions s SET revoked_at = now(), revoked_reason = 'PASSWORD_RESET'
     FROM users u
     WHERE s.user_id = u.id AND s.revoked_at IS NULL AND u.email = ANY($1::text[])`,
    [admins.map((admin) => admin.email)]
  );
  console.log('Administradores provisionados.');
} finally {
  await client.end();
}
