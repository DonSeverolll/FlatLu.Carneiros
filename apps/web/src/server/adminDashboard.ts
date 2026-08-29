import { z } from 'zod';
import { query } from './db';
import { isIsoDate, todayIso } from './dates';

/**
 * Números do painel.
 *
 * Além do que foi pedido (vendas e agendamentos por dia, semana e mês), há
 * três indicadores que decidem o resultado de aluguel por temporada e não
 * aparecem numa lista de reservas: taxa de ocupação, diária média e o que
 * está travado esperando alguém agir.
 *
 * Receita conta só o que foi efetivamente recebido (`paid_at`), não o valor
 * contratado — reserva confirmada que ainda não pagou é expectativa, e
 * misturar as duas coisas num gráfico de faturamento engana quem olha.
 */

const isoDate = z.string().refine(isIsoDate, 'Use o formato YYYY-MM-DD');

export const dashboardSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  unit: z.string().min(1).max(180).optional(),
  granularity: z.enum(['day', 'week', 'month']).default('day')
});

export type DashboardInput = z.infer<typeof dashboardSchema>;

function defaultRange(input: DashboardInput) {
  const to = input.to ?? todayIso();
  if (input.from) return { from: input.from, to };
  // 90 dias cobre a janela em que a maioria das reservas é feita e paga.
  const [y, m, d] = to.split('-').map(Number);
  const inicio = new Date(Date.UTC(y!, m! - 1, d! - 89));
  return { from: inicio.toISOString().slice(0, 10), to };
}

export async function dashboard(input: DashboardInput) {
  const { from, to } = defaultRange(input);
  const unit = input.unit ?? null;
  const bucket = input.granularity;

  const [resumo, serie, porUnidade, ocupacao, proximos, atencao, origem] = await Promise.all([
    // ---- resumo do período ------------------------------------------------
    query(
      `SELECT
         (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
            JOIN reservations r ON r.id = p.reservation_id
            JOIN properties prop ON prop.id = r.property_id
           WHERE p.status IN ('PAID','PARTIAL') AND p.paid_at::date BETWEEN $1::date AND $2::date
             AND ($3::text IS NULL OR prop.slug = $3)) AS recebido,
         (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
            JOIN reservations r ON r.id = p.reservation_id
            JOIN properties prop ON prop.id = r.property_id
           WHERE p.status IN ('PENDING','PROCESSING') AND r.status IN ('PENDING_PAYMENT','CONFIRMED')
             AND ($3::text IS NULL OR prop.slug = $3)) AS a_receber,
         (SELECT COUNT(*) FROM reservations r
            JOIN properties prop ON prop.id = r.property_id
           WHERE r.created_at::date BETWEEN $1::date AND $2::date
             AND ($3::text IS NULL OR prop.slug = $3)) AS reservas_criadas,
         (SELECT COUNT(*) FROM reservations r
            JOIN properties prop ON prop.id = r.property_id
           WHERE r.created_at::date BETWEEN $1::date AND $2::date
             AND r.status IN ('CONFIRMED','COMPLETED')
             AND ($3::text IS NULL OR prop.slug = $3)) AS reservas_confirmadas,
         (SELECT COALESCE(SUM(r.check_out - r.check_in), 0) FROM reservations r
            JOIN properties prop ON prop.id = r.property_id
           WHERE r.status IN ('CONFIRMED','COMPLETED')
             AND r.check_in <= $2::date AND r.check_out > $1::date
             AND ($3::text IS NULL OR prop.slug = $3)) AS noites_vendidas`,
      [from, to, unit]
    ),

    // ---- série temporal: recebido e reservas por balde ---------------------
    query(
      `WITH baldes AS (
         SELECT generate_series(date_trunc($4, $1::timestamp), date_trunc($4, $2::timestamp),
                                ('1 ' || $4)::interval) AS inicio
       )
       SELECT to_char(b.inicio, 'YYYY-MM-DD') AS periodo,
              COALESCE((SELECT SUM(p.amount) FROM payments p
                          JOIN reservations r ON r.id = p.reservation_id
                          JOIN properties prop ON prop.id = r.property_id
                         WHERE p.status IN ('PAID','PARTIAL')
                           AND date_trunc($4, p.paid_at) = b.inicio
                           AND ($3::text IS NULL OR prop.slug = $3)), 0) AS recebido,
              COALESCE((SELECT COUNT(*) FROM reservations r
                          JOIN properties prop ON prop.id = r.property_id
                         WHERE date_trunc($4, r.created_at) = b.inicio
                           AND ($3::text IS NULL OR prop.slug = $3)), 0) AS reservas,
              COALESCE((SELECT COUNT(*) FROM reservations r
                          JOIN properties prop ON prop.id = r.property_id
                         WHERE date_trunc($4, r.check_in::timestamp) = b.inicio
                           AND r.status IN ('CONFIRMED','COMPLETED','PENDING_PAYMENT')
                           AND ($3::text IS NULL OR prop.slug = $3)), 0) AS check_ins,
              COALESCE((SELECT COUNT(*) FROM reservations r
                          JOIN properties prop ON prop.id = r.property_id
                         WHERE date_trunc($4, r.check_out::timestamp) = b.inicio
                           AND r.status IN ('CONFIRMED','COMPLETED','PENDING_PAYMENT')
                           AND ($3::text IS NULL OR prop.slug = $3)), 0) AS check_outs
       FROM baldes b ORDER BY b.inicio`,
      [from, to, unit, bucket]
    ),

    // ---- por unidade -------------------------------------------------------
    query(
      `SELECT prop.slug, COALESCE(prop.short_name, prop.name) AS unidade, prop.color,
              COALESCE((SELECT SUM(p.amount) FROM payments p
                          JOIN reservations r ON r.id = p.reservation_id
                         WHERE r.property_id = prop.id
                           AND p.status IN ('PAID','PARTIAL')
                           AND p.paid_at::date BETWEEN $1::date AND $2::date), 0) AS recebido,
              COALESCE((SELECT COUNT(*) FROM reservations r
                         WHERE r.property_id = prop.id
                           AND r.status IN ('CONFIRMED','COMPLETED')
                           AND r.check_in <= $2::date AND r.check_out > $1::date), 0) AS reservas,
              COALESCE((SELECT SUM(r.check_out - r.check_in) FROM reservations r
                         WHERE r.property_id = prop.id
                           AND r.status IN ('CONFIRMED','COMPLETED')
                           AND r.check_in <= $2::date AND r.check_out > $1::date), 0) AS noites
       FROM properties prop
       WHERE prop.active = true AND ($3::text IS NULL OR prop.slug = $3)
       ORDER BY prop.display_order`,
      [from, to, unit]
    ),

    // ---- ocupação: noites bloqueadas sobre noites disponíveis -------------
    query(
      `SELECT prop.slug, COALESCE(prop.short_name, prop.name) AS unidade,
              COUNT(*) FILTER (WHERE ocupada) AS noites_ocupadas,
              COUNT(*) AS noites_periodo
       FROM properties prop
       CROSS JOIN LATERAL (
         SELECT d::date AS dia,
                EXISTS (SELECT 1 FROM inventory_blocks b
                         WHERE b.property_id = prop.id AND b.active
                           AND b.blocked_nights @> d::date) AS ocupada
         FROM generate_series($1::date, $2::date, interval '1 day') d
       ) noites
       WHERE prop.active = true AND ($3::text IS NULL OR prop.slug = $3)
       GROUP BY prop.slug, prop.short_name, prop.name, prop.display_order
       ORDER BY prop.display_order`,
      [from, to, unit]
    ),

    // ---- próximos 14 dias: quem chega e quem sai ---------------------------
    query(
      `SELECT r.id, r.check_in::text AS check_in, r.check_out::text AS check_out,
              r.status, r.payment_status, r.guest_count, r.total_amount,
              r.checked_in_at, r.checked_out_at,
              COALESCE(prop.short_name, prop.name) AS unidade, prop.color,
              u.full_name AS hospede, u.phone, u.email
       FROM reservations r
       JOIN properties prop ON prop.id = r.property_id
       JOIN users u ON u.id = r.customer_id
       WHERE r.status IN ('PENDING_PAYMENT','CONFIRMED')
         AND (r.check_in BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
           OR r.check_out BETWEEN CURRENT_DATE AND CURRENT_DATE + 14)
         AND ($1::text IS NULL OR prop.slug = $1)
       ORDER BY r.check_in`,
      [unit]
    ),

    // ---- o que está travado esperando ação --------------------------------
    query(
      `SELECT
         (SELECT COUNT(*) FROM payments p JOIN reservations r ON r.id = p.reservation_id
           WHERE p.status = 'PENDING' AND p.due_date < CURRENT_DATE
             AND r.status IN ('PENDING_PAYMENT','CONFIRMED')) AS pagamentos_atrasados,
         (SELECT COUNT(*) FROM reservations r
           WHERE r.status = 'PENDING_PAYMENT'
             AND NOT EXISTS (SELECT 1 FROM contracts c
                              WHERE c.reservation_id = r.id AND c.status = 'SIGNED')) AS contratos_pendentes,
         (SELECT COUNT(*) FROM reservations r
           WHERE r.status = 'PENDING_PAYMENT' AND r.payment_status = 'PENDING'
             AND r.expires_at BETWEEN now() AND now() + interval '2 hours') AS holds_expirando,
         (SELECT COUNT(*) FROM crm_leads
           WHERE stage NOT IN ('WON','LOST')
             AND next_action_at IS NOT NULL AND next_action_at < now()) AS crm_atrasado,
         (SELECT COUNT(*) FROM reservations r
           WHERE r.status = 'CONFIRMED' AND r.check_out < CURRENT_DATE) AS a_concluir`
    ),

    // ---- origem das reservas ----------------------------------------------
    query(
      `SELECT r.source AS origem, COUNT(*) AS total
       FROM reservations r JOIN properties prop ON prop.id = r.property_id
       WHERE r.created_at::date BETWEEN $1::date AND $2::date
         AND ($3::text IS NULL OR prop.slug = $3)
       GROUP BY r.source ORDER BY total DESC`,
      [from, to, unit]
    )
  ]);

  const linha = resumo.rows[0] as Record<string, string>;
  const noitesVendidas = Number(linha.noites_vendidas ?? 0);
  const recebido = Number(linha.recebido ?? 0);
  const criadas = Number(linha.reservas_criadas ?? 0);
  const confirmadas = Number(linha.reservas_confirmadas ?? 0);

  const ocupacaoLinhas = ocupacao.rows as { noites_ocupadas: string; noites_periodo: string }[];
  const ocupadas = ocupacaoLinhas.reduce((soma, r) => soma + Number(r.noites_ocupadas), 0);
  const disponiveis = ocupacaoLinhas.reduce((soma, r) => soma + Number(r.noites_periodo), 0);

  return {
    range: { from, to, granularity: bucket, unit },
    resumo: {
      recebido,
      aReceber: Number(linha.a_receber ?? 0),
      reservasCriadas: criadas,
      reservasConfirmadas: confirmadas,
      /* Quantas das reservas criadas viraram reserva confirmada. */
      conversao: criadas ? Math.round((confirmadas / criadas) * 100) : 0,
      noitesVendidas,
      /* Diária média do que foi efetivamente recebido. */
      diariaMedia: noitesVendidas ? Math.round((recebido / noitesVendidas) * 100) / 100 : 0,
      ocupacao: disponiveis ? Math.round((ocupadas / disponiveis) * 100) : 0
    },
    serie: serie.rows,
    porUnidade: porUnidade.rows,
    ocupacaoPorUnidade: ocupacao.rows.map((r) => {
      const linha = r as Record<string, string>;
      const total = Number(linha.noites_periodo);
      return {
        ...linha,
        percentual: total ? Math.round((Number(linha.noites_ocupadas) / total) * 100) : 0
      };
    }),
    proximos: proximos.rows,
    atencao: atencao.rows[0],
    origem: origem.rows
  };
}
