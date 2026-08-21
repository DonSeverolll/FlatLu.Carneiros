import { z } from 'zod';
import { query, transaction } from './db';
import { badRequest, unauthorized } from './errors';
import { hashPassword, verifyPassword } from './auth';

export const MIN_PASSWORD_LENGTH = 12;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200)
  })
  .refine((value) => value.currentPassword !== value.newPassword, 'A nova senha deve ser diferente');

/**
 * Troca de senha. Não existia rota para isso: qualquer senha provisionada por
 * script ficava para sempre. Trocar a senha derruba as outras sessões — é o que
 * torna a troca útil depois de uma credencial ter sido exposta.
 */
export async function changePassword(
  userId: string,
  input: z.infer<typeof changePasswordSchema>,
  keepRefreshTokenHash?: string
) {
  const found = await query<{ password_hash: string }>(
    `SELECT password_hash FROM users
     WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
    [userId]
  );
  const user = found.rows[0];
  if (!user) throw unauthorized();
  if (!(await verifyPassword(user.password_hash, input.currentPassword))) {
    throw badRequest('CURRENT_PASSWORD_INVALID');
  }

  const nextHash = await hashPassword(input.newPassword);

  return transaction(async (client) => {
    await client.query(
      `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
      [userId, nextHash]
    );
    const revoked = await client.query(
      `UPDATE user_sessions
       SET revoked_at = now(), revoked_reason = 'PASSWORD_CHANGED'
       WHERE user_id = $1 AND revoked_at IS NULL
         AND ($2::text IS NULL OR refresh_token_hash <> $2)`,
      [userId, keepRefreshTokenHash ?? null]
    );
    await client.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'USER', $1, 'PASSWORD_CHANGED', $2)`,
      [userId, JSON.stringify({ revokedSessions: revoked.rowCount ?? 0 })]
    );
    return { revokedSessions: revoked.rowCount ?? 0 };
  });
}
