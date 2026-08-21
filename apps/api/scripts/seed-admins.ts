import 'dotenv/config';
import argon2 from 'argon2';
import pg from 'pg';

const { Pool } = pg;
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const pool = new Pool({
  connectionString: required('DATABASE_URL'),
  ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false
});

const admins = [1, 2].map((number) => ({
  username: required(`ADMIN_${number}_USERNAME`),
  email: required(`ADMIN_${number}_EMAIL`).toLowerCase(),
  password: required(`ADMIN_${number}_PASSWORD`)
}));

try {
  for (const admin of admins) {
    if (admin.password.length < 12) throw new Error(`${admin.username} password must have at least 12 characters`);
    const passwordHash = await argon2.hash(admin.password, { type: argon2.argon2id });
    await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $1, 'ADMIN')
       ON CONFLICT (email) WHERE deleted_at IS NULL
       DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash,
                     full_name = EXCLUDED.full_name, role = 'ADMIN', status = 'ACTIVE', deleted_at = NULL,
                     updated_at = now()`,
      [admin.username, admin.email, passwordHash]
    );
  }
  console.log('Admin users provisioned.');
} finally {
  await pool.end();
}