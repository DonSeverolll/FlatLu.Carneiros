import { z } from 'zod';
import type { PoolClient } from 'pg';
import { query } from './db';
import { notFound } from './errors';
import { isIsoDate } from './dates';

/**
 * CRM enxuto: um card por oportunidade, com estágio, dono e — o que faz um CRM
 * funcionar — uma próxima ação com data. Lista sem próxima ação vira arquivo
 * morto em duas semanas.
 *
 * A automação é a parte importante: reserva criada no site vira card sozinha, e
 * o estágio acompanha o que de fato aconteceu (contrato assinado, sinal pago,
 * hold expirado). Assim ninguém precisa lembrar de alimentar o funil, e o
 * painel não mente sobre o pipeline.
 */

const isoDate = z.string().refine(isIsoDate, 'Use o formato YYYY-MM-DD');

export const STAGES = ['NEW', 'CONTACTED', 'QUOTED', 'NEGOTIATING', 'WON', 'LOST'] as const;

export const leadListSchema = z.object({
  stage: z.enum(STAGES).optional(),
  owner: z.string().uuid().optional(),
  overdueOnly: z.coerce.boolean().optional(),
  search: z.string().trim().max(160).optional()
});

export const leadCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().email().max(320).optional(),
  phone: z.string().trim().max(32).optional(),
  propertyId: z.string().uuid().optional(),
  checkIn: isoDate.optional(),
  checkOut: isoDate.optional(),
  estimatedAmount: z.number().nonnegative().max(1_000_000).optional(),
  source: z.string().trim().max(40).default('MANUAL'),
  nextAction: z.string().trim().max(200).optional(),
  nextActionAt: z.string().datetime().optional()
});

export const leadUpdateSchema = z
  .object({
    stage: z.enum(STAGES).optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    nextAction: z.string().trim().max(200).nullable().optional(),
    nextActionAt: z.string().datetime().nullable().optional(),
    estimatedAmount: z.number().nonnegative().max(1_000_000).nullable().optional(),
    lostReason: z.string().trim().max(200).nullable().optional()
  })
  .strict();

export const activitySchema = z.object({
  kind: z.enum(['NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING']).default('NOTE'),
  body: z.string().trim().min(1).max(4000)
});

const LEAD_COLUMNS = `
  l.id, l.name, l.email, l.phone, l.stage::text AS stage, l.source,
  l.estimated_amount, l.check_in::text AS check_in, l.check_out::text AS check_out,
  l.next_action, l.next_action_at, l.lost_reason, l.created_at, l.updated_at,
  l.closed_at, l.customer_id, l.reservation_id,
  COALESCE(p.short_name, p.name) AS unidade, p.color AS unidade_cor,
  dono.full_name AS dono,
  (l.next_action_at IS NOT NULL AND l.next_action_at < now()
    AND l.stage NOT IN ('WON','LOST')) AS atrasado`;

export async function listLeads(input: z.infer<typeof leadListSchema>) {
  const search = input.search ? `%${input.search.toLowerCase()}%` : null;
  const result = await query(
    `SELECT ${LEAD_COLUMNS}
     FROM crm_leads l
     LEFT JOIN properties p ON p.id = l.property_id
     LEFT JOIN users dono ON dono.id = l.owner_user_id
     WHERE ($1::crm_stage IS NULL OR l.stage = $1)
       AND ($2::uuid IS NULL OR l.owner_user_id = $2)
       AND ($3::boolean IS NOT TRUE OR (l.next_action_at < now() AND l.stage NOT IN ('WON','LOST')))
       AND ($4::text IS NULL OR lower(l.name) LIKE $4 OR lower(COALESCE(l.email,'')) LIKE $4
            OR lower(COALESCE(l.phone,'')) LIKE $4)
     ORDER BY
       CASE WHEN l.stage IN ('WON','LOST') THEN 1 ELSE 0 END,
       l.next_action_at NULLS LAST, l.created_at DESC`,
    [input.stage ?? null, input.owner ?? null, input.overdueOnly ?? null, search]
  );

  const porEstagio = await query(
    `SELECT stage::text AS stage, COUNT(*) AS total,
            COALESCE(SUM(estimated_amount), 0) AS valor
     FROM crm_leads GROUP BY stage`
  );

  return { leads: result.rows, byStage: porEstagio.rows };
}

export async function leadDetail(leadId: string) {
  const lead = await query(
    `SELECT ${LEAD_COLUMNS}
     FROM crm_leads l
     LEFT JOIN properties p ON p.id = l.property_id
     LEFT JOIN users dono ON dono.id = l.owner_user_id
     WHERE l.id = $1`,
    [leadId]
  );
  if (!lead.rowCount) throw notFound('LEAD_NOT_FOUND');

  const atividades = await query(
    `SELECT a.id, a.kind, a.body, a.metadata, a.created_at, u.full_name AS autor
     FROM crm_activities a LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.lead_id = $1 ORDER BY a.created_at DESC`,
    [leadId]
  );

  return { lead: lead.rows[0], activities: atividades.rows };
}

export async function createLead(input: z.infer<typeof leadCreateSchema>, actorId: string) {
  const result = await query(
    `INSERT INTO crm_leads (name, email, phone, property_id, check_in, check_out,
                            estimated_amount, source, next_action, next_action_at, owner_user_id)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.name,
      input.email ?? null,
      input.phone ?? null,
      input.propertyId ?? null,
      input.checkIn ?? null,
      input.checkOut ?? null,
      input.estimatedAmount ?? null,
      input.source,
      input.nextAction ?? null,
      input.nextActionAt ?? null,
      actorId
    ]
  );
  const id = result.rows[0]!.id as string;
  await addActivity(id, actorId, { kind: 'NOTE', body: 'Card criado manualmente.' });
  return leadDetail(id);
}

const FIELDS = [
  ['stage', 'stage'],
  ['ownerUserId', 'owner_user_id'],
  ['nextAction', 'next_action'],
  ['nextActionAt', 'next_action_at'],
  ['estimatedAmount', 'estimated_amount'],
  ['lostReason', 'lost_reason']
] as const;

export async function updateLead(
  leadId: string,
  actorId: string,
  input: z.infer<typeof leadUpdateSchema>
) {
  const assignments: string[] = [];
  const values: unknown[] = [leadId];

  for (const [campo, coluna] of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, campo)) {
      values.push(input[campo]);
      assignments.push(`${coluna} = $${values.length}${campo === 'stage' ? '::crm_stage' : ''}`);
    }
  }
  if (!assignments.length) throw notFound('NO_FIELDS_TO_UPDATE');

  if (input.stage === 'WON' || input.stage === 'LOST') {
    assignments.push('closed_at = now()');
  } else if (input.stage) {
    assignments.push('closed_at = NULL');
  }

  const result = await query(
    `UPDATE crm_leads SET ${assignments.join(', ')}, updated_at = now()
     WHERE id = $1 RETURNING id, stage::text AS stage`,
    values
  );
  if (!result.rowCount) throw notFound('LEAD_NOT_FOUND');

  if (input.stage) {
    await addActivity(leadId, actorId, {
      kind: 'NOTE',
      body: `Estágio alterado para ${input.stage}.`
    });
  }
  return leadDetail(leadId);
}

export async function addActivity(
  leadId: string,
  actorId: string | null,
  input: z.infer<typeof activitySchema>,
  client?: PoolClient
) {
  const runner = client ? client.query.bind(client) : query;
  await runner(
    `INSERT INTO crm_activities (lead_id, actor_user_id, kind, body)
     VALUES ($1, $2, $3, $4)`,
    [leadId, actorId, input.kind, input.body]
  );
}

// ---------------------------------------------------------------------------
// Automação
// ---------------------------------------------------------------------------

/**
 * Estágio derivado do que realmente aconteceu com a reserva. Deixar o estágio
 * na mão de quem lembra de arrastar o card é o que faz pipeline mentir.
 */
export function stageForReservation(status: string, paymentStatus: string, signed: boolean): string {
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'LOST';
  if (status === 'COMPLETED' || paymentStatus === 'PAID') return 'WON';
  if (paymentStatus === 'PARTIAL') return 'WON';
  if (signed) return 'NEGOTIATING';
  return 'QUOTED';
}

/** Próximo passo sugerido, com prazo, conforme o ponto do funil. */
function nextActionFor(stage: string, expiresAt: string | null, checkIn: string) {
  switch (stage) {
    case 'QUOTED':
      return { action: 'Confirmar interesse e cobrar assinatura do contrato', at: expiresAt };
    case 'NEGOTIATING':
      return { action: 'Cobrar o pagamento do sinal', at: expiresAt };
    case 'WON':
      return { action: 'Enviar instruções de check-in', at: `${checkIn}T09:00:00Z` };
    default:
      return { action: null, at: null };
  }
}

/**
 * Cria ou atualiza o card a partir da reserva. Chamada na criação da reserva e
 * a cada liquidação de pagamento — idempotente pelo índice único em
 * `reservation_id`.
 */
export async function syncLeadFromReservation(reservationId: string, client?: PoolClient) {
  const runner = client ? client.query.bind(client) : query;

  const dados = await runner(
    `SELECT r.id, r.status, r.payment_status, r.total_amount, r.property_id,
            r.check_in::text AS check_in, r.check_out::text AS check_out,
            r.expires_at, r.customer_id, r.source,
            u.full_name, u.email, u.phone,
            EXISTS (SELECT 1 FROM contracts c
                     WHERE c.reservation_id = r.id AND c.status = 'SIGNED') AS assinado
     FROM reservations r JOIN users u ON u.id = r.customer_id
     WHERE r.id = $1`,
    [reservationId]
  );
  const reserva = dados.rows[0] as Record<string, string> | undefined;
  if (!reserva) return null;

  const stage = stageForReservation(
    reserva.status!,
    reserva.payment_status!,
    Boolean(reserva.assinado)
  );
  const proximo = nextActionFor(stage, reserva.expires_at ?? null, reserva.check_in!);

  const result = await runner(
    `INSERT INTO crm_leads (customer_id, reservation_id, property_id, name, email, phone,
                            stage, source, estimated_amount, check_in, check_out,
                            next_action, next_action_at,
                            closed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::crm_stage, $8, $9, $10::date, $11::date, $12, $13,
             CASE WHEN $7 IN ('WON','LOST') THEN now() ELSE NULL END)
     ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL
     DO UPDATE SET stage = EXCLUDED.stage,
                   estimated_amount = EXCLUDED.estimated_amount,
                   next_action = EXCLUDED.next_action,
                   next_action_at = EXCLUDED.next_action_at,
                   closed_at = EXCLUDED.closed_at,
                   updated_at = now()
     RETURNING id, (xmax = 0) AS criado`,
    [
      reserva.customer_id,
      reservationId,
      reserva.property_id,
      reserva.full_name,
      reserva.email,
      reserva.phone ?? null,
      stage,
      reserva.source ?? 'SITE',
      reserva.total_amount,
      reserva.check_in,
      reserva.check_out,
      proximo.action,
      proximo.at
    ]
  );

  const lead = result.rows[0] as { id: string; criado: boolean };
  await addActivity(
    lead.id,
    null,
    {
      kind: 'NOTE',
      body: lead.criado
        ? `Card aberto pela reserva de ${reserva.check_in} a ${reserva.check_out}.`
        : `Reserva atualizada: ${reserva.status} / pagamento ${reserva.payment_status}.`
    },
    client
  );

  return lead.id;
}
