import { z } from 'zod';
import { query, transaction, violatedConstraint } from './db';
import { badRequest, conflict, notFound } from './errors';
import { hashPassword } from './auth';
import { MIN_PASSWORD_LENGTH } from './password';

/**
 * Gestão de usuários pelo administrador.
 *
 * Duas regras que valem a pena registrar:
 *
 * 1. Um administrador não pode rebaixar nem suspender a si mesmo. Sem isso, um
 *    clique errado deixa o sistema sem ninguém capaz de administrar.
 * 2. Redefinir senha de outra pessoa derruba as sessões dela. Se a senha foi
 *    trocada porque a conta pode estar comprometida, manter a sessão viva
 *    anula o motivo da troca.
 */

export const userListSchema = z.object({
  role: z.enum(['ADMIN', 'CUSTOMER']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export const userUpdateSchema = z
  .object({
    fullName: z.string().trim().min(3).max(160).optional(),
    email: z.string().email().max(320).optional(),
    username: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{3,80}$/, 'Use 3 a 80 caracteres: letras, números ou _')
      .nullable()
      .optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    role: z.enum(['ADMIN', 'CUSTOMER']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional()
  })
  .strict();

export const passwordResetSchema = z.object({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200)
});

export async function listUsers(input: z.infer<typeof userListSchema>) {
  const search = input.search ? `%${input.search.toLowerCase()}%` : null;
  const result = await query(
    `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.role, u.status,
            u.avatar_url, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM user_sessions s
              WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now())
              AS sessoes_ativas,
            (SELECT COUNT(*) FROM reservations r WHERE r.customer_id = u.id) AS reservas
     FROM users u
     WHERE u.deleted_at IS NULL
       AND ($1::user_role IS NULL OR u.role = $1)
       AND ($2::user_status IS NULL OR u.status = $2)
       AND ($3::text IS NULL OR lower(u.full_name) LIKE $3 OR lower(u.email) LIKE $3
            OR lower(COALESCE(u.username,'')) LIKE $3)
     ORDER BY u.role DESC, u.full_name
     LIMIT $4`,
    [input.role ?? null, input.status ?? null, search, input.limit]
  );
  return result.rows;
}

const FIELDS = [
  ['fullName', 'full_name'],
  ['email', 'email'],
  ['username', 'username'],
  ['phone', 'phone'],
  ['role', 'role'],
  ['status', 'status']
] as const;

export async function updateUser(
  targetId: string,
  actorId: string,
  input: z.infer<typeof userUpdateSchema>
) {
  if (targetId === actorId && (input.role === 'CUSTOMER' || input.status === 'SUSPENDED')) {
    throw badRequest('CANNOT_DEMOTE_SELF');
  }

  const assignments: string[] = [];
  const values: unknown[] = [targetId];

  for (const [campo, coluna] of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, campo)) {
      let valor: unknown = input[campo];
      if (campo === 'email' && typeof valor === 'string') valor = valor.trim().toLowerCase();
      values.push(valor);
      const cast = campo === 'role' ? '::user_role' : campo === 'status' ? '::user_status' : '';
      assignments.push(`${coluna} = $${values.length}${cast}`);
    }
  }
  if (!assignments.length) throw conflict('NO_FIELDS_TO_UPDATE');

  return transaction(async (client) => {
    let updated;
    try {
      updated = await client.query(
        `UPDATE users SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, full_name, username, email, phone, role, status`,
        values
      );
    } catch (error) {
      const constraint = violatedConstraint(error);
      if (constraint === 'users_email_unique') throw conflict('EMAIL_ALREADY_REGISTERED');
      if (constraint === 'users_username_unique') throw conflict('USERNAME_ALREADY_TAKEN');
      if (constraint === 'users_username_format') throw badRequest('USERNAME_INVALID');
      throw error;
    }
    if (!updated.rowCount) throw notFound('USER_NOT_FOUND');

    // Suspender precisa derrubar as sessões, senão a conta segue navegando.
    if (input.status === 'SUSPENDED') {
      await client.query(
        `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'SUSPENDED'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [targetId]
      );
    }

    await client.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'USER', $2, 'UPDATED_BY_ADMIN', $3)`,
      [actorId, targetId, JSON.stringify({ fields: Object.keys(input) })]
    );

    return updated.rows[0];
  });
}

/**
 * Redefinição de senha pelo administrador — o caso "o cliente esqueceu".
 * Não devolve a senha em lugar nenhum além da resposta desta chamada: quem
 * definiu é quem repassa.
 */
export async function resetUserPassword(
  targetId: string,
  actorId: string,
  input: z.infer<typeof passwordResetSchema>
) {
  const hash = await hashPassword(input.newPassword);

  return transaction(async (client) => {
    const updated = await client.query(
      `UPDATE users SET password_hash = $2, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, full_name, email, username`,
      [targetId, hash]
    );
    if (!updated.rowCount) throw notFound('USER_NOT_FOUND');

    const revoked = await client.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'ADMIN_PASSWORD_RESET'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [targetId]
    );

    await client.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'USER', $2, 'PASSWORD_RESET_BY_ADMIN', $3)`,
      [actorId, targetId, JSON.stringify({ revokedSessions: revoked.rowCount ?? 0 })]
    );

    return { user: updated.rows[0], revokedSessions: revoked.rowCount ?? 0 };
  });
}

/** Sugestão de senha forte, para o administrador não inventar "123456". */
export function suggestPassword(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => alfabeto[n % alfabeto.length]).join('');
}
