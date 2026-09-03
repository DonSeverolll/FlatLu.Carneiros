import { query } from './db';

/**
 * Registro de auditoria.
 *
 * A tabela `audit_events` já existia e cada módulo montava o INSERT na mão.
 * Este helper existe para os pontos que passaram a registrar depois — login,
 * logout, cadastro, liberação de bloqueio — para que a lista de eventos do
 * painel não dependa de cada autor lembrar o formato certo.
 *
 * Auditoria nunca pode derrubar a operação que ela observa: se o INSERT
 * falhar, o erro é engolido. Perder uma linha de log é ruim; recusar um login
 * porque o log falhou é pior.
 */

export type AuditEntity =
  | 'USER'
  | 'RESERVATION'
  | 'PROPERTY'
  | 'CONTRACT'
  | 'PAYMENT'
  | 'SESSION';

export type AuditInput = {
  actorUserId?: string | null;
  entityType: AuditEntity;
  /** Nulo quando o evento não aponta para uma linha — ex.: login que falhou. */
  entityId?: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.actorUserId ?? null,
        input.entityType,
        input.entityId ?? null,
        input.eventType,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  } catch (error) {
    console.error('[audit] falha ao registrar evento', input.eventType, error);
  }
}
