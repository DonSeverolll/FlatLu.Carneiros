import { z } from 'zod';
import { query, transaction, violatedConstraint } from './db';
import { conflict, notFound } from './errors';
import { isIsoDate } from './dates';

const isoDate = z.string().refine(isIsoDate, 'Use o formato YYYY-MM-DD');

export const agendaSchema = z.object({ from: isoDate, to: isoDate });

export const cancelSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  refund: z.boolean().default(false)
});

export const maintenanceSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    source: z.enum(['MAINTENANCE', 'CLEANING', 'OWNER_USE']).default('MAINTENANCE'),
    reason: z.string().trim().min(3).max(500)
  })
  .refine((value) => value.endDate > value.startDate, 'endDate deve ser depois de startDate');

export const updatePropertySchema = z
  .object({
    nightlyRate: z.number().nonnegative().max(1_000_000).optional(),
    depositPercentage: z.number().min(0).max(100).optional(),
    minNights: z.number().int().min(1).max(90).optional(),
    maxGuests: z.number().int().min(1).max(30).optional(),
    holdMinutes: z.number().int().min(5).max(1440).optional(),
    bookingHorizonDays: z.number().int().min(1).max(1095).optional(),
    description: z.string().trim().min(10).max(4000).optional(),
    termsVersion: z.string().trim().min(1).max(32).optional(),
    termsContent: z.string().trim().min(10).optional(),
    pixKey: z.string().trim().max(200).nullable().optional(),
    pixHolderName: z.string().trim().max(160).nullable().optional(),
    paymentInstructions: z.string().trim().max(2000).nullable().optional(),
    heroImageUrl: z.string().url().max(2000).nullable().optional(),
    amenities: z.array(z.string().trim().min(1).max(60)).max(30).optional()
  })
  .strict();

export async function agenda(range: z.infer<typeof agendaSchema>) {
  const result = await query(
    `SELECT r.id, r.check_in::text AS check_in, r.check_out::text AS check_out,
            r.status, r.payment_status, r.guest_count, r.total_amount, r.deposit_amount,
            r.expires_at, u.full_name AS customer_name, u.email AS customer_email,
            u.phone AS customer_phone,
            (SELECT p.reference FROM payments p
              WHERE p.reservation_id = r.id ORDER BY p.created_at DESC LIMIT 1) AS payment_reference
     FROM reservations r
     JOIN users u ON u.id = r.customer_id
     WHERE r.check_in < $2::date AND r.check_out > $1::date
     ORDER BY r.check_in`,
    [range.from, range.to]
  );
  return result.rows;
}

export async function cancelReservation(
  reservationId: string,
  adminId: string,
  input: z.infer<typeof cancelSchema>
) {
  return transaction(async (client) => {
    const result = await client.query(
      `UPDATE reservations
       SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = $2,
           payment_status = CASE WHEN $3 AND payment_status IN ('PAID','PARTIAL')
                                 THEN 'REFUNDED'::payment_status ELSE payment_status END,
           updated_at = now()
       WHERE id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED')
       RETURNING id, status, payment_status, cancelled_at`,
      [reservationId, input.reason, input.refund]
    );
    if (!result.rowCount) throw notFound('ACTIVE_RESERVATION_NOT_FOUND');

    await client.query(
      `UPDATE inventory_blocks SET active = false
       WHERE reservation_id = $1 AND source = 'RESERVATION' AND active = true`,
      [reservationId]
    );
    await client.query(
      `UPDATE payments SET status = 'FAILED', updated_at = now()
       WHERE reservation_id = $1 AND status = 'PENDING'`,
      [reservationId]
    );
    await client.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'RESERVATION', $2, 'CANCELLED', $3)`,
      [adminId, reservationId, JSON.stringify({ reason: input.reason, refund: input.refund })]
    );
    return result.rows[0];
  });
}

export async function blockDates(
  propertyId: string,
  adminId: string,
  input: z.infer<typeof maintenanceSchema>
) {
  try {
    const result = await query(
      `INSERT INTO inventory_blocks (property_id, source, blocked_period)
       SELECT p.id, $4::inventory_source, tstzrange(
                (($2::date + p.check_in_time) AT TIME ZONE p.timezone),
                (($3::date + p.check_out_time) AT TIME ZONE p.timezone),
                '[)')
       FROM properties p WHERE p.id = $1 AND p.active = true
       RETURNING id, property_id, source,
                 lower(blocked_period) AS starts_at, upper(blocked_period) AS ends_at`,
      [propertyId, input.startDate, input.endDate, input.source]
    );
    if (!result.rowCount) throw notFound('PROPERTY_NOT_FOUND');

    await query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'PROPERTY', $2, 'BLOCK_CREATED', $3)`,
      [
        adminId,
        propertyId,
        JSON.stringify({ reason: input.reason, source: input.source, blockId: result.rows[0].id })
      ]
    );
    return result.rows[0];
  } catch (error) {
    if (violatedConstraint(error) === 'inventory_blocks_no_overlap') {
      throw conflict('DATES_UNAVAILABLE');
    }
    throw error;
  }
}

const PROPERTY_FIELDS = [
  ['nightlyRate', 'nightly_rate'],
  ['depositPercentage', 'deposit_percentage'],
  ['minNights', 'min_nights'],
  ['maxGuests', 'max_guests'],
  ['holdMinutes', 'hold_minutes'],
  ['bookingHorizonDays', 'booking_horizon_days'],
  ['description', 'description'],
  ['termsVersion', 'terms_version'],
  ['termsContent', 'terms_content'],
  ['pixKey', 'pix_key'],
  ['pixHolderName', 'pix_holder_name'],
  ['paymentInstructions', 'payment_instructions'],
  ['heroImageUrl', 'hero_image_url']
] as const;

/**
 * Permite publicar a diaria, o percentual do sinal e a chave Pix sem abrir o
 * SQL Editor. Enquanto `nightly_rate` for 0, a vitrine mostra "sob consulta"
 * e a criacao de reserva e recusada - preco errado nunca vai ao ar.
 */
export async function updateProperty(
  propertyId: string,
  adminId: string,
  input: z.infer<typeof updatePropertySchema>
) {
  const assignments: string[] = [];
  const values: unknown[] = [propertyId];

  for (const [field, column] of PROPERTY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      values.push(input[field]);
      assignments.push(`${column} = $${values.length}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'amenities')) {
    values.push(JSON.stringify(input.amenities));
    assignments.push(`amenities = $${values.length}::jsonb`);
  }
  if (!assignments.length) throw conflict('NO_FIELDS_TO_UPDATE');

  const result = await query(
    `UPDATE properties SET ${assignments.join(', ')}, updated_at = now()
     WHERE id = $1 AND active = true
     RETURNING id, slug, nightly_rate, deposit_percentage, min_nights, max_guests,
               hold_minutes, booking_horizon_days, terms_version,
               pix_key IS NOT NULL AS pix_configured`,
    values
  );
  const property = result.rows[0];
  if (!property) throw notFound('PROPERTY_NOT_FOUND');

  await query(
    `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
     VALUES ($1, 'PROPERTY', $2, 'UPDATED', $3)`,
    [adminId, propertyId, JSON.stringify({ fields: Object.keys(input) })]
  );
  return property;
}
