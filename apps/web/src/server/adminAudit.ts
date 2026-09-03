import { z } from 'zod';
import { query } from './db';

/**
 * Log de eventos do painel.
 *
 * Lê `audit_events` e resolve o alvo de cada linha para um rótulo legível: sem
 * isso a tela mostraria pares de UUID, que não dizem nada a quem opera. Cada
 * tipo de entidade tem seu próprio LEFT JOIN porque `entity_id` é polimórfico
 * — aponta para tabelas diferentes conforme `entity_type`.
 *
 * A paginação é por offset. É o padrão do resto do painel e a tabela cresce
 * devagar (algumas dezenas de linhas por mês); cursor seria complexidade sem
 * ganho no volume que esta operação tem.
 */

export const auditListSchema = z.object({
  search: z.string().trim().max(160).optional(),
  eventType: z.string().trim().max(60).optional(),
  entityType: z.enum(['USER', 'RESERVATION', 'PROPERTY', 'CONTRACT', 'PAYMENT', 'SESSION']).optional(),
  actor: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0)
});

const SELECT_EVENTOS = `
  SELECT a.id,
         a.event_type,
         a.entity_type,
         a.entity_id,
         a.metadata,
         a.created_at,
         a.actor_user_id,
         COALESCE(autor.full_name, 'Sistema')  AS actor_name,
         autor.username                        AS actor_username,
         autor.role                            AS actor_role,
         -- Rótulo do alvo, resolvido por tipo. Só um dos ramos casa por linha.
         CASE a.entity_type
           WHEN 'USER'        THEN alvo_user.full_name
           WHEN 'PROPERTY'    THEN COALESCE(alvo_prop.short_name, alvo_prop.name)
           WHEN 'RESERVATION' THEN COALESCE(hospede.full_name, '') ||
                                   COALESCE(' · ' || COALESCE(prop_res.short_name, prop_res.name), '')
           WHEN 'CONTRACT'    THEN COALESCE(hospede_ct.full_name, 'Contrato')
           WHEN 'PAYMENT'     THEN COALESCE(hospede_pg.full_name, 'Pagamento')
           ELSE NULL
         END                                   AS target_label
    FROM audit_events a
    LEFT JOIN users autor          ON autor.id = a.actor_user_id
    LEFT JOIN users alvo_user      ON a.entity_type = 'USER' AND alvo_user.id = a.entity_id
    LEFT JOIN properties alvo_prop ON a.entity_type = 'PROPERTY' AND alvo_prop.id = a.entity_id
    LEFT JOIN reservations res     ON a.entity_type = 'RESERVATION' AND res.id = a.entity_id
    LEFT JOIN users hospede        ON hospede.id = res.customer_id
    LEFT JOIN properties prop_res  ON prop_res.id = res.property_id
    LEFT JOIN contracts ct         ON a.entity_type = 'CONTRACT' AND ct.id = a.entity_id
    LEFT JOIN reservations res_ct  ON res_ct.id = ct.reservation_id
    LEFT JOIN users hospede_ct     ON hospede_ct.id = res_ct.customer_id
    LEFT JOIN payments pg          ON a.entity_type = 'PAYMENT' AND pg.id = a.entity_id
    LEFT JOIN reservations res_pg  ON res_pg.id = pg.reservation_id
    LEFT JOIN users hospede_pg     ON hospede_pg.id = res_pg.customer_id
`;

/**
 * O filtro de texto varre o tipo do evento, o nome de quem agiu e o conteúdo
 * do metadata. `metadata::text` casa o JSON inteiro — é o que permite achar
 * um bloqueio pelo motivo digitado ("Obras") sem indexar campo a campo.
 */
const WHERE_EVENTOS = `
  WHERE ($1::text IS NULL
         OR lower(a.event_type) LIKE $1
         OR lower(COALESCE(autor.full_name, '')) LIKE $1
         OR lower(COALESCE(autor.username, '')) LIKE $1
         OR lower(a.metadata::text) LIKE $1)
    AND ($2::text IS NULL OR a.event_type = $2)
    AND ($3::text IS NULL OR a.entity_type = $3)
    AND ($4::uuid IS NULL OR a.actor_user_id = $4)
    AND ($5::date IS NULL OR a.created_at >= $5::date)
    AND ($6::date IS NULL OR a.created_at < ($6::date + 1))
`;

export async function listAuditEvents(input: z.infer<typeof auditListSchema>) {
  const filtros = [
    input.search ? `%${input.search.toLowerCase()}%` : null,
    input.eventType ?? null,
    input.entityType ?? null,
    input.actor ?? null,
    input.from ?? null,
    input.to ?? null
  ];

  const eventos = await query(
    `${SELECT_EVENTOS} ${WHERE_EVENTOS}
     ORDER BY a.created_at DESC
     LIMIT $7 OFFSET $8`,
    [...filtros, input.limit, input.offset]
  );

  const total = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM audit_events a
     LEFT JOIN users autor ON autor.id = a.actor_user_id
     ${WHERE_EVENTOS}`,
    filtros
  );

  // Alimenta os seletores da tela com o que existe de fato, em vez de uma
  // lista fixa que envelhece toda vez que um evento novo passa a ser gravado.
  const tipos = await query<{ event_type: string; total: string }>(
    `SELECT event_type, COUNT(*)::text AS total
       FROM audit_events GROUP BY event_type ORDER BY event_type`
  );

  const autores = await query<{ id: string; full_name: string; username: string | null }>(
    `SELECT DISTINCT u.id, u.full_name, u.username
       FROM audit_events a JOIN users u ON u.id = a.actor_user_id
      ORDER BY u.full_name`
  );

  return {
    events: eventos.rows,
    total: Number(total.rows[0]?.total ?? 0),
    limit: input.limit,
    offset: input.offset,
    eventTypes: tipos.rows.map((t) => ({ value: t.event_type, total: Number(t.total) })),
    actors: autores.rows
  };
}
