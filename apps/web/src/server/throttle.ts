import { query } from './db';
import { tooManyRequests } from './errors';

/**
 * Throttle com estado no banco. Contadores em memória não servem: cada
 * invocação serverless pode rodar em uma instância diferente, então um limite
 * local seria trivial de burlar.
 */
export type ThrottlePolicy = { maxAttempts: number; windowSeconds: number };

export const LOGIN_POLICY: ThrottlePolicy = { maxAttempts: 8, windowSeconds: 900 };
export const REGISTER_POLICY: ThrottlePolicy = { maxAttempts: 5, windowSeconds: 3600 };

export async function assertWithinLimit(
  scope: string,
  identifier: string,
  policy: ThrottlePolicy
) {
  const result = await query<{ failures: string; oldest: string | null }>(
    `SELECT count(*)::text AS failures, min(created_at)::text AS oldest
     FROM auth_attempts
     WHERE scope = $1 AND identifier = $2 AND succeeded = false
       AND created_at > now() - ($3 || ' seconds')::interval`,
    [scope, identifier.slice(0, 320), String(policy.windowSeconds)]
  );
  const failures = Number(result.rows[0]?.failures ?? 0);
  if (failures < policy.maxAttempts) return;

  const oldest = result.rows[0]?.oldest ? new Date(result.rows[0].oldest).getTime() : Date.now();
  const retryAfter = Math.max(
    30,
    Math.ceil((oldest + policy.windowSeconds * 1000 - Date.now()) / 1000)
  );
  throw tooManyRequests(retryAfter);
}

export async function recordAttempt(scope: string, identifier: string, succeeded: boolean) {
  const key = identifier.slice(0, 320);
  if (succeeded) {
    // Sucesso zera o histórico de falhas para não punir quem acertou a senha.
    await query(`DELETE FROM auth_attempts WHERE scope = $1 AND identifier = $2`, [scope, key]);
    return;
  }
  await query(`INSERT INTO auth_attempts (scope, identifier, succeeded) VALUES ($1, $2, false)`, [scope, key]);
}
