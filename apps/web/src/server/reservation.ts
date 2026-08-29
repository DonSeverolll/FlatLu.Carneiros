import { z } from 'zod';
import { query, transaction, violatedConstraint } from './db';
import { badRequest, conflict, notFound } from './errors';
import { isIsoDate, nightsBetween, todayIso } from './dates';
import { centsToNumeric } from './pricing';
import { assertBookable, quoteForProperty } from './quote';
import { depositFor } from './rates';
import { releaseExpiredHolds } from './inventory';
import { findProperty } from './property';
import { syncLeadFromReservation } from './crm';

const isoDate = z.string().refine(isIsoDate, 'Use o formato YYYY-MM-DD');

export const createReservationSchema = z.object({
  propertyId: z.string().min(1).max(180),
  checkIn: isoDate,
  checkOut: isoDate,
  guestCount: z.number().int().positive(),
  termsAccepted: z.literal(true),
  idempotencyKey: z.string().min(16).max(128)
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

const RESERVATION_COLUMNS = `
  id, property_id, check_in::text AS check_in, check_out::text AS check_out,
  status, payment_status, guest_count, total_amount, deposit_amount,
  terms_accepted, accepted_terms_version, created_at, expires_at`;

export async function createReservation(
  input: CreateReservationInput,
  session: { id: string },
  context: { ip?: string | null }
) {
  const property = await findProperty(input.propertyId);

  // ---- Regras que o front-end não pode decidir -----------------------------
  const nights = nightsBetween(input.checkIn, input.checkOut);
  if (nights <= 0) throw badRequest('CHECKOUT_BEFORE_CHECKIN');
  if (input.guestCount > property.max_guests) {
    throw badRequest('ABOVE_MAX_GUESTS', { maxGuests: property.max_guests });
  }

  const today = todayIso(property.timezone);
  if (input.checkIn < today) throw badRequest('CHECKIN_IN_THE_PAST');
  if (nightsBetween(today, input.checkIn) > property.booking_horizon_days) {
    throw badRequest('BEYOND_BOOKING_HORIZON', { horizonDays: property.booking_horizon_days });
  }

  /**
   * O preço vem do calendário de tarifas, não de uma diária única: dia da
   * semana, períodos especiais, pacotes fechados e estadia mínima por dia de
   * chegada saem todos daqui. `assertBookable` recusa antes de tocar no
   * estoque — é a mesma função que responde o orçamento da vitrine, então o
   * valor mostrado e o valor gravado não podem divergir.
   */
  const stayQuote = await quoteForProperty(property, input.checkIn, input.checkOut);
  assertBookable(stayQuote);

  const amounts = {
    totalCents: stayQuote.totalCents,
    depositCents: depositFor(stayQuote.totalCents, property.deposit_percentage)
  };

  return transaction(async (client) => {
    // Dentro da transação: garante que holds vencidos já liberaram o gist.
    await releaseExpiredHolds(client);

    const inserted = await client.query(
      `INSERT INTO reservations (
         property_id, customer_id, check_in, check_out, guest_count,
         total_amount, deposit_amount, terms_accepted, accepted_terms_version,
         accepted_at, accepted_ip, idempotency_key, expires_at, rate_breakdown
       ) VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, true, $8, now(), $9, $10,
                 now() + ($11 || ' minutes')::interval, $12::jsonb)
       -- O predicado e obrigatorio: reservations_idempotency_unique e um
       -- indice PARCIAL, e o PostgreSQL so consegue inferi-lo como arbitro
       -- quando o ON CONFLICT repete o WHERE do indice. Sem isso: erro 42P10.
       ON CONFLICT (customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING ${RESERVATION_COLUMNS}`,
      [
        property.id,
        session.id,
        input.checkIn,
        input.checkOut,
        input.guestCount,
        centsToNumeric(amounts.totalCents),
        centsToNumeric(amounts.depositCents),
        property.terms_version,
        context.ip ?? null,
        input.idempotencyKey,
        String(property.hold_minutes),
        // Sem o extrato, uma reserva antiga fica sem explicação depois que a
        // tabela de preços muda.
        JSON.stringify({ lines: stayQuote.lines, appliedPeriods: stayQuote.appliedPeriods })
      ]
    );

    // Requisição repetida (retry de rede, duplo clique): devolve a mesma reserva.
    if (!inserted.rowCount) {
      const existing = await client.query(
        `SELECT ${RESERVATION_COLUMNS} FROM reservations
         WHERE customer_id = $1 AND idempotency_key = $2`,
        [session.id, input.idempotencyKey]
      );
      return { reservation: existing.rows[0], created: false };
    }

    const reservation = inserted.rows[0];

    try {
      /**
       * Ocupa as NOITES da estadia: [check-in, check-out). O dia do check-out
       * não é uma noite e segue vendável, então a virada no mesmo dia funciona
       * independentemente dos horários de chegada e saída.
       */
      await client.query(
        `INSERT INTO inventory_blocks (property_id, reservation_id, source, blocked_nights)
         VALUES ($1, $2, 'RESERVATION', daterange($3::date, $4::date + $5::int, '[)'))`,
        [property.id, reservation.id, input.checkIn, input.checkOut, property.cleaning_gap_days]
      );
    } catch (error) {
      if (violatedConstraint(error) === 'inventory_blocks_no_overlap') {
        throw conflict('DATES_UNAVAILABLE');
      }
      throw error;
    }

    await client.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'RESERVATION', $2, 'CREATED', $3)`,
      [
        session.id,
        reservation.id,
        JSON.stringify({
          nights,
          totalCents: amounts.totalCents,
          depositCents: amounts.depositCents,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          appliedPeriods: stayQuote.appliedPeriods
        })
      ]
    );

    // O funil acompanha o que aconteceu, sem depender de alguém alimentar.
    await syncLeadFromReservation(reservation.id, client);

    return { reservation, created: true };
  });
}

/**
 * Com três espaços, o hóspede precisa ver QUAL ele reservou. As colunas da
 * unidade entram por join nas leituras; o INSERT continua sem elas porque
 * RETURNING não junta tabelas.
 */
const UNIT_JOIN_COLUMNS = `
  p.slug AS unit_slug, COALESCE(p.short_name, p.name) AS unit_name,
  p.color AS unit_color, p.location_name AS unit_location,
  p.location_url AS unit_location_url,
  p.check_in_time::text AS check_in_time, p.check_out_time::text AS check_out_time`;

const RESERVATION_READ_COLUMNS = `
  r.id, r.property_id, r.check_in::text AS check_in, r.check_out::text AS check_out,
  r.status, r.payment_status, r.guest_count, r.total_amount, r.deposit_amount,
  r.terms_accepted, r.accepted_terms_version, r.created_at, r.expires_at,
  r.rate_breakdown`;

export async function listMyReservations(customerId: string) {
  const result = await query(
    `SELECT ${RESERVATION_READ_COLUMNS}, ${UNIT_JOIN_COLUMNS}
     FROM reservations r JOIN properties p ON p.id = r.property_id
     WHERE r.customer_id = $1 ORDER BY r.check_in DESC`,
    [customerId]
  );
  return result.rows;
}

export async function getMyReservation(customerId: string, reservationId: string) {
  const result = await query(
    `SELECT ${RESERVATION_READ_COLUMNS}, ${UNIT_JOIN_COLUMNS}
     FROM reservations r JOIN properties p ON p.id = r.property_id
     WHERE r.id = $1 AND r.customer_id = $2`,
    [reservationId, customerId]
  );
  const reservation = result.rows[0];
  if (!reservation) throw notFound('RESERVATION_NOT_FOUND');
  return reservation;
}
