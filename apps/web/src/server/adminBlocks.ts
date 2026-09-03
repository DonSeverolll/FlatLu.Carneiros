import { z } from 'zod';
import { recordAudit } from './audit';
import { query } from './db';
import { AppError, conflict, notFound } from './errors';

/**
 * Datas fora de venda e datas especiais, em um lugar só.
 *
 * Antes daqui só existia o POST que cria um bloqueio: depois de criado, ele
 * ficava invisível e permanente — só dava para desfazer no banco. Era o que
 * segurava o Réveillon do Flat sem ninguém conseguir ver o motivo.
 *
 * Duas semânticas de intervalo convivem e é fácil confundi-las:
 *
 *   inventory_blocks.blocked_nights  daterange '[)'  — o fim é a data de
 *                                    LIBERAÇÃO, igual a um check-out.
 *   rate_periods.starts_on/ends_on   ambos inclusivos — `ends_on` é a última
 *                                    NOITE do período.
 *
 * Por isso a comparação entre os dois soma um dia ao `ends_on` antes de testar
 * sobreposição. Errar isso faz um período aparecer como livre no último dia.
 */

export const blockListSchema = z.object({
  /**
   * Bloqueios já liberados entram na lista quando `history` vem ligado.
   *
   * Nada de `z.coerce.boolean()` aqui: ele aplica `Boolean(valor)`, e a string
   * "false" é verdadeira em JavaScript — o filtro desligado traria justamente
   * o que deveria esconder. A comparação é explícita.
   */
  history: z
    .enum(['true', 'false'])
    .default('false')
    .transform((valor) => valor === 'true'),
  unit: z.string().trim().max(80).optional()
});

export const releaseSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});

/** Reservas seguram data por si; liberar o bloqueio venderia a noite duas vezes. */
const RELEASE_SOURCES = ['MAINTENANCE', 'CLEANING', 'OWNER_USE'] as const;

export async function listCalendarEntries(input: z.infer<typeof blockListSchema>) {
  const blocks = await query(
    `SELECT b.id,
            b.source,
            b.active,
            b.reservation_id,
            b.created_at,
            lower(b.blocked_nights)::text            AS first_night,
            (upper(b.blocked_nights) - 1)::text      AS last_night,
            upper(b.blocked_nights)::text            AS released_on,
            (upper(b.blocked_nights) - lower(b.blocked_nights)) AS nights,
            p.id                                     AS unit_id,
            p.slug                                   AS unit_slug,
            COALESCE(p.short_name, p.name)           AS unit_name,
            p.color                                  AS unit_color,
            criado.reason,
            criado.created_at                        AS reason_at,
            autor.full_name                          AS created_by,
            liberado.reason                          AS release_reason,
            liberado.created_at                      AS released_at,
            quem_liberou.full_name                   AS released_by,
            -- Reserva por trás do bloqueio, quando houver: sem isso a origem
            -- RESERVATION apareceria sem dizer de quem é a estadia.
            hospede.full_name                        AS guest_name,
            -- Períodos especiais que este bloqueio cobre, no todo ou em parte.
            COALESCE(conflitos.nomes, ARRAY[]::text[]) AS covers_periods
       FROM inventory_blocks b
       JOIN properties p ON p.id = b.property_id
       LEFT JOIN LATERAL (
            SELECT a.metadata->>'reason' AS reason, a.actor_user_id, a.created_at
              FROM audit_events a
             WHERE a.event_type = 'BLOCK_CREATED'
               AND a.metadata->>'blockId' = b.id::text
             ORDER BY a.created_at DESC
             LIMIT 1
       ) criado ON true
       LEFT JOIN users autor ON autor.id = criado.actor_user_id
       LEFT JOIN LATERAL (
            SELECT a.metadata->>'reason' AS reason, a.actor_user_id, a.created_at
              FROM audit_events a
             WHERE a.event_type = 'BLOCK_RELEASED'
               AND a.metadata->>'blockId' = b.id::text
             ORDER BY a.created_at DESC
             LIMIT 1
       ) liberado ON true
       LEFT JOIN users quem_liberou ON quem_liberou.id = liberado.actor_user_id
       LEFT JOIN reservations r ON r.id = b.reservation_id
       LEFT JOIN users hospede ON hospede.id = r.customer_id
       LEFT JOIN LATERAL (
            SELECT array_agg(rp.name ORDER BY rp.starts_on) AS nomes
              FROM rate_periods rp
             WHERE rp.property_id = b.property_id
               AND rp.active
               AND rp.starts_on IS NOT NULL
               AND b.blocked_nights && daterange(rp.starts_on, (rp.ends_on + 1), '[)')
       ) conflitos ON true
      WHERE ($1::boolean OR b.active)
        AND ($2::text IS NULL OR p.slug = $2)
      ORDER BY b.active DESC, lower(b.blocked_nights) ASC`,
    [input.history, input.unit ?? null]
  );

  const periods = await query(
    `SELECT rp.id,
            rp.name,
            rp.starts_on::text                       AS first_night,
            rp.ends_on::text                         AS last_night,
            (rp.ends_on - rp.starts_on + 1)          AS nights,
            rp.nightly_amount,
            rp.package_amount,
            rp.min_nights,
            rp.requires_full_period,
            rp.priority,
            rp.active,
            p.slug                                   AS unit_slug,
            COALESCE(p.short_name, p.name)           AS unit_name,
            p.color                                  AS unit_color,
            -- Quantas noites do período estão fora de venda agora. Zero
            -- significa vendável; qualquer coisa acima disso é o motivo de o
            -- período especial não aparecer para o hóspede.
            COALESCE((
              SELECT SUM(
                       (LEAST(upper(b.blocked_nights), rp.ends_on + 1)
                        - GREATEST(lower(b.blocked_nights), rp.starts_on))
                     )
                FROM inventory_blocks b
               WHERE b.property_id = rp.property_id
                 AND b.active
                 AND b.blocked_nights && daterange(rp.starts_on, (rp.ends_on + 1), '[)')
            ), 0)                                    AS blocked_nights
       FROM rate_periods rp
       JOIN properties p ON p.id = rp.property_id
      WHERE ($1::boolean OR rp.active)
        AND ($2::text IS NULL OR p.slug = $2)
      ORDER BY rp.starts_on ASC, p.display_order ASC`,
    [input.history, input.unit ?? null]
  );

  return { blocks: blocks.rows, periods: periods.rows };
}

/**
 * Libera as noites de um bloqueio manual.
 *
 * Não apaga a linha: marca `active = false`. A restrição de exclusão do banco
 * só considera bloqueios ativos, então desativar já devolve as datas à venda —
 * e o histórico de quem bloqueou, quando e por quê continua consultável.
 */
export async function releaseBlock(blockId: string, adminId: string, reason: string) {
  const atual = await query<{
    source: string;
    active: boolean;
    reservation_id: string | null;
    first_night: string;
    last_night: string;
    property_id: string;
    unit_name: string;
  }>(
    `SELECT b.source, b.active, b.reservation_id, b.property_id,
            lower(b.blocked_nights)::text       AS first_night,
            (upper(b.blocked_nights) - 1)::text AS last_night,
            COALESCE(p.short_name, p.name)      AS unit_name
       FROM inventory_blocks b
       JOIN properties p ON p.id = b.property_id
      WHERE b.id = $1`,
    [blockId]
  );

  const bloqueio = atual.rows[0];
  if (!bloqueio) throw notFound('BLOCK_NOT_FOUND');
  if (!bloqueio.active) throw conflict('BLOCK_ALREADY_RELEASED');

  if (!RELEASE_SOURCES.includes(bloqueio.source as (typeof RELEASE_SOURCES)[number])) {
    // Bloqueio de reserva é consequência, não causa: some quando a reserva é
    // cancelada. Liberar aqui deixaria a reserva viva sobre uma data vendável.
    throw new AppError(409, 'BLOCK_BELONGS_TO_RESERVATION', {
      reservationId: bloqueio.reservation_id
    });
  }

  const result = await query(
    `UPDATE inventory_blocks
        SET active = false
      WHERE id = $1 AND active = true
      RETURNING id`,
    [blockId]
  );
  if (!result.rowCount) throw conflict('BLOCK_ALREADY_RELEASED');

  await recordAudit({
    actorUserId: adminId,
    entityType: 'PROPERTY',
    entityId: bloqueio.property_id,
    eventType: 'BLOCK_RELEASED',
    metadata: {
      blockId,
      reason,
      source: bloqueio.source,
      unit: bloqueio.unit_name,
      firstNight: bloqueio.first_night,
      lastNight: bloqueio.last_night
    }
  });

  return {
    id: blockId,
    unitName: bloqueio.unit_name,
    firstNight: bloqueio.first_night,
    lastNight: bloqueio.last_night
  };
}
