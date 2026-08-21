import { z } from 'zod';
import { query, transaction, violatedConstraint } from './db';
import { badRequest, conflict, notFound } from './errors';
import { isIsoDate, nightsBetween, todayIso } from './dates';
import { centsToNumeric, quote } from './pricing';
import { releaseExpiredHolds } from './inventory';
import { findProperty } from './property';

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
  if (nights < property.min_nights) {
    throw badRequest('BELOW_MIN_NIGHTS', { minNights: property.min_nights });
  }
  if (input.guestCount > property.max_guests) {
    throw badRequest('ABOVE_MAX_GUESTS', { maxGuests: property.max_guests });
  }

  const today = todayIso(property.timezone);
  if (input.checkIn < today) throw badRequest('CHECKIN_IN_THE_PAST');
  if (nightsBetween(today, input.checkIn) > property.booking_horizon_days) {
    throw badRequest('BEYOND_BOOKING_HORIZON', { horizonDays: property.booking_horizon_days });
  }

  // A diária ainda não publicada geraria uma reserva de R$ 0,00.
  if (Number(property.nightly_rate) <= 0) throw conflict('RATE_NOT_PUBLISHED');

  const amounts = quote({
    nightlyRate: property.nightly_rate,
    depositPercentage: property.deposit_percentage,
    nights
  });

  return transaction(async (client) => {
    // Dentro da transação: garante que holds vencidos já liberaram o gist.
    await releaseExpiredHolds(client);

    const inserted = await client.query(
      `INSERT INTO reservations (
         property_id, customer_id, check_in, check_out, guest_count,
         total_amount, deposit_amount, terms_accepted, accepted_terms_version,
         accepted_at, accepted_ip, idempotency_key, expires_at
       ) VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, true, $8, now(), $9, $10,
                 now() + ($11 || ' minutes')::interval)
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
        String(property.hold_minutes)
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
      await client.query(
        `INSERT INTO inventory_blocks (property_id, reservation_id, source, blocked_period)
         VALUES ($1, $2, 'RESERVATION', tstzrange(
           (($3::date + $5::time) AT TIME ZONE $7),
           ((($4::date + $6::time) AT TIME ZONE $7) + ($8::int * interval '1 hour')),
           '[)'
         ))`,
        [
          property.id,
          reservation.id,
          input.checkIn,
          input.checkOut,
          property.check_in_time,
          property.check_out_time,
          property.timezone,
          property.cleaning_gap_hours
        ]
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
          checkOut: input.checkOut
        })
      ]
    );

    return { reservation, created: true };
  });
}

export async function listMyReservations(customerId: string) {
  const result = await query(
    `SELECT ${RESERVATION_COLUMNS} FROM reservations
     WHERE customer_id = $1 ORDER BY check_in DESC`,
    [customerId]
  );
  return result.rows;
}

export async function getMyReservation(customerId: string, reservationId: string) {
  const result = await query(
    `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE id = $1 AND customer_id = $2`,
    [reservationId, customerId]
  );
  const reservation = result.rows[0];
  if (!reservation) throw notFound('RESERVATION_NOT_FOUND');
  return reservation;
}
