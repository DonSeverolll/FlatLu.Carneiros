import { query } from './db';
import type { PoolClient } from 'pg';

/**
 * Libera holds vencidos.
 *
 * Duas correções em relação à versão anterior:
 *
 * 1. `payment_status = 'PENDING'` na cláusula. Antes, uma reserva com pagamento
 *    PARCIAL continuava em PENDING_PAYMENT e era expirada pelo varredor — o
 *    hóspede pagava o sinal e perdia a data.
 * 2. Não há mais `setInterval`. Em serverless o processo morre entre requests,
 *    então a varredura roda no início de toda consulta de disponibilidade e de
 *    toda criação de reserva (dentro da mesma transação), além de um cron
 *    diário como rede de segurança.
 */
const RELEASE_SQL = `
  WITH expired AS (
    UPDATE reservations
    SET status = 'EXPIRED', updated_at = now()
    WHERE status = 'PENDING_PAYMENT'
      AND payment_status = 'PENDING'
      AND expires_at <= now()
    RETURNING id
  ), unblocked AS (
    UPDATE inventory_blocks SET active = false
    WHERE reservation_id IN (SELECT id FROM expired) AND active = true
    RETURNING id
  )
  SELECT (SELECT count(*) FROM expired)::int AS reservations,
         (SELECT count(*) FROM unblocked)::int AS blocks`;

export async function releaseExpiredHolds(client?: PoolClient) {
  const runner = client ? client.query.bind(client) : query;
  const result = await runner(RELEASE_SQL, []);
  const row = result.rows[0] as { reservations: number; blocks: number } | undefined;
  return { reservations: row?.reservations ?? 0, blocks: row?.blocks ?? 0 };
}

/** Cancela cobranças pendentes de reservas que já morreram. */
export async function cancelOrphanPayments() {
  const result = await query(
    `UPDATE payments p SET status = 'FAILED', updated_at = now()
     FROM reservations r
     WHERE p.reservation_id = r.id
       AND p.status = 'PENDING'
       AND r.status IN ('EXPIRED', 'CANCELLED')`
  );
  return result.rowCount ?? 0;
}

export async function purgeOldAuthAttempts() {
  const result = await query(`DELETE FROM auth_attempts WHERE created_at < now() - interval '2 days'`);
  return result.rowCount ?? 0;
}

export async function purgeExpiredSessions() {
  const result = await query(
    `DELETE FROM user_sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'`
  );
  return result.rowCount ?? 0;
}
