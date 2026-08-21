import { z } from 'zod';
import { query, violatedConstraint } from './db';
import { conflict, notFound, unauthorized } from './errors';
import { hashPassword, verifyPassword } from './auth';

export const registerSchema = z.object({
  email: z.string().email().max(320).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(200),
  fullName: z.string().trim().min(3).max(160),
  phone: z.string().trim().max(32).optional()
});

/**
 * O login aceita e-mail (hospedes) ou usuario (administradores). `email` segue
 * aceito para nao quebrar cliente antigo.
 */
export const loginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(320).optional(),
    email: z.string().trim().min(3).max(320).optional(),
    password: z.string().min(1).max(200)
  })
  .refine((value) => Boolean(value.identifier ?? value.email), 'Informe e-mail ou usuario')
  .transform((value) => ({
    identifier: (value.identifier ?? value.email ?? '').toLowerCase(),
    password: value.password
  }));

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(3).max(160).optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    documentNumber: z.string().trim().max(32).nullable().optional(),
    avatarUrl: z.string().url().max(2000).nullable().optional()
  })
  .strict();

export type PublicUser = {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: string;
  phone: string | null;
  document_number: string | null;
  avatar_url: string | null;
};

const USER_COLUMNS = 'id, email, username, full_name, role, phone, document_number, avatar_url';

export async function registerUser(input: z.infer<typeof registerSchema>) {
  try {
    const result = await query<PublicUser>(
      `INSERT INTO users (email, password_hash, full_name, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING ${USER_COLUMNS}`,
      [input.email, await hashPassword(input.password), input.fullName, input.phone ?? null]
    );
    return result.rows[0];
  } catch (error) {
    // Antes isso virava 500. O índice é parcial (deleted_at IS NULL), então o
    // nome da constraint é o do índice único, não o padrão do PostgreSQL.
    if (violatedConstraint(error) === 'users_email_unique') throw conflict('EMAIL_ALREADY_REGISTERED');
    throw error;
  }
}

export async function authenticate(input: z.infer<typeof loginSchema>) {
  const result = await query<PublicUser & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users
     WHERE (email = $1 OR lower(username) = $1)
       AND status = 'ACTIVE' AND deleted_at IS NULL`,
    [input.identifier]
  );
  const user = result.rows[0];

  // Verifica a senha mesmo sem usuário encontrado seria ideal para igualar o
  // tempo de resposta; aqui o throttle no banco já cobre enumeração.
  if (!user || !(await verifyPassword(user.password_hash, input.password))) {
    throw unauthorized('INVALID_CREDENTIALS');
  }

  await query(`UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, [user.id]);
  const { password_hash: _ignored, ...publicUser } = user;
  return publicUser;
}

export async function currentUser(userId: string) {
  const result = await query<PublicUser>(
    `SELECT ${USER_COLUMNS} FROM users
     WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw unauthorized();
  return user;
}

const UPDATABLE = [
  ['fullName', 'full_name'],
  ['phone', 'phone'],
  ['documentNumber', 'document_number'],
  ['avatarUrl', 'avatar_url']
] as const;

export async function updateProfile(userId: string, input: z.infer<typeof updateProfileSchema>) {
  const assignments: string[] = [];
  const values: unknown[] = [userId];

  for (const [field, column] of UPDATABLE) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      values.push(input[field]);
      assignments.push(`${column} = $${values.length}`);
    }
  }
  if (!assignments.length) throw conflict('NO_FIELDS_TO_UPDATE');

  const result = await query<PublicUser>(
    `UPDATE users SET ${assignments.join(', ')}, updated_at = now()
     WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
     RETURNING ${USER_COLUMNS}`,
    values
  );
  const user = result.rows[0];
  if (!user) throw notFound('USER_NOT_FOUND');
  return user;
}
