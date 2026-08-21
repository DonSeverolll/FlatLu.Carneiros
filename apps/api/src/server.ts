import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { createSession, hashPassword, requireAdmin, requireUser, verifyPassword } from './auth.js';

const app = Fastify({ logger: true });

await app.register(helmet);
await app.register(cookie);
await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });

const releaseExpiredHolds = async () => {
  await pool.query(
    `WITH expired AS (
       UPDATE reservations SET status = 'EXPIRED', updated_at = now()
       WHERE status = 'PENDING_PAYMENT' AND expires_at <= now()
       RETURNING id
     )
     UPDATE inventory_blocks SET active = false
     WHERE reservation_id IN (SELECT id FROM expired) AND active = true`
  );
};
setInterval(() => void releaseExpiredHolds().catch((error) => app.log.error(error)), 60_000).unref();

app.get('/health', async () => ({ status: 'ok' }));

app.get('/properties/:slug', async (request, reply) => {
  const params = z.object({ slug: z.string().min(1).max(180) }).parse(request.params);
  const result = await pool.query(
    `SELECT id, name, slug, description, currency, nightly_rate,
            deposit_percentage, terms_version, terms_content
     FROM properties WHERE slug = $1 AND active = true`,
    [params.slug]
  );
  if (!result.rowCount) return reply.code(404).send({ error: 'PROPERTY_NOT_FOUND' });
  return { property: result.rows[0] };
});

app.get('/properties/:propertyId/availability', async (request, reply) => {
  await releaseExpiredHolds();
  const params = z.object({ propertyId: z.string().uuid() }).parse(request.params);
  const query = z.object({
    from: z.coerce.date(),
    to: z.coerce.date()
  }).refine((value) => value.to > value.from, 'to must be after from').parse(request.query);

  const result = await pool.query(
    `SELECT lower(blocked_period) AS starts_at, upper(blocked_period) AS ends_at, source
     FROM inventory_blocks
     WHERE property_id = $1
       AND active = true
       AND blocked_period && tstzrange($2::timestamptz, $3::timestamptz, '[)')
     ORDER BY starts_at`,
    [params.propertyId, query.from.toISOString(), query.to.toISOString()]
  );

  return { blocked: result.rows };
});

app.get('/admin/reservations', async (request, reply) => {
  try {
    await requireAdmin(request);
  } catch (error) {
    return reply.code(error instanceof Error && error.message === 'FORBIDDEN' ? 403 : 401)
      .send({ error: error instanceof Error && error.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAUTHORIZED' });
  }
  const query = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(request.query);
  const result = await pool.query(
    `SELECT r.id, r.check_in, r.check_out, r.status, r.payment_status,
            r.total_amount, u.full_name AS customer_name, u.email AS customer_email
     FROM reservations r JOIN users u ON u.id = r.customer_id
     WHERE r.check_in < $2::date AND r.check_out > $1::date
     ORDER BY r.check_in`,
    [query.from.toISOString(), query.to.toISOString()]
  );
  return { reservations: result.rows };
});

app.post('/admin/reservations/:reservationId/cancel', async (request, reply) => {
  let session;
  try {
    session = await requireAdmin(request);
  } catch (error) {
    return reply.code(error instanceof Error && error.message === 'FORBIDDEN' ? 403 : 401)
      .send({ error: error instanceof Error && error.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAUTHORIZED' });
  }
  const params = z.object({ reservationId: z.string().uuid() }).parse(request.params);
  const input = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE reservations
       SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = $2, updated_at = now()
       WHERE id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED')
       RETURNING id, status, cancelled_at`,
      [params.reservationId, input.reason]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'ACTIVE_RESERVATION_NOT_FOUND' });
    }
    await client.query(
      `UPDATE inventory_blocks SET active = false
       WHERE reservation_id = $1 AND source = 'RESERVATION' AND active = true`,
      [params.reservationId]
    );
    await client.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'RESERVATION', $2, 'CANCELLED', $3)`,
      [session.id, params.reservationId, JSON.stringify({ reason: input.reason })]
    );
    await client.query('COMMIT');
    return { reservation: result.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/admin/properties/:propertyId/maintenance', async (request, reply) => {
  let session;
  try {
    session = await requireAdmin(request);
  } catch (error) {
    return reply.code(error instanceof Error && error.message === 'FORBIDDEN' ? 403 : 401)
      .send({ error: error instanceof Error && error.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAUTHORIZED' });
  }
  const params = z.object({ propertyId: z.string().uuid() }).parse(request.params);
  const input = z.object({ startDate: z.coerce.date(), endDate: z.coerce.date(), reason: z.string().trim().min(3).max(500) })
    .refine((value) => value.endDate > value.startDate, 'endDate must be after startDate').parse(request.body);
  try {
    const result = await pool.query(
      `INSERT INTO inventory_blocks (property_id, source, blocked_period)
       SELECT $1, 'MAINTENANCE', tstzrange(
         ($2::date AT TIME ZONE timezone), ($3::date AT TIME ZONE timezone), '[)'
       ) FROM properties WHERE id = $1 AND active = true
       RETURNING id, property_id, source, lower(blocked_period) AS starts_at, upper(blocked_period) AS ends_at`,
      [params.propertyId, input.startDate.toISOString(), input.endDate.toISOString()]
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'PROPERTY_NOT_FOUND' });
    await pool.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'PROPERTY', $2, 'MAINTENANCE_BLOCK_CREATED', $3)`,
      [session.id, params.propertyId, JSON.stringify({ reason: input.reason, blockId: result.rows[0].id })]
    );
    return reply.code(201).send({ block: result.rows[0] });
  } catch (error: unknown) {
    if ((error as { constraint?: string }).constraint === 'inventory_blocks_no_overlap') {
      return reply.code(409).send({ error: 'DATES_UNAVAILABLE' });
    }
    throw error;
  }
});

app.post('/reservations', async (request, reply) => {
  let session: Awaited<ReturnType<typeof requireUser>>;
  try {
    session = await requireUser(request);
  } catch {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }
  const input = z.object({
    propertyId: z.string().uuid(),
    checkIn: z.coerce.date(),
    checkOut: z.coerce.date(),
    guestCount: z.number().int().positive().max(8),
    termsAccepted: z.literal(true),
    idempotencyKey: z.string().min(16).max(128)
  }).refine((value) => value.checkOut > value.checkIn, 'checkOut must be after checkIn').parse(request.body);

  await releaseExpiredHolds();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const propertyResult = await client.query(
      `SELECT id, nightly_rate, deposit_percentage, terms_version, check_in_time,
              check_out_time, cleaning_gap_hours, timezone
       FROM properties WHERE id = $1 AND active = true FOR SHARE`,
      [input.propertyId]
    );
    const property = propertyResult.rows[0];
    if (!property) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'PROPERTY_NOT_FOUND' });
    }

    const nights = Math.round((input.checkOut.getTime() - input.checkIn.getTime()) / 86_400_000);
    const totalAmount = Number(property.nightly_rate) * nights;
    const depositAmount = totalAmount * Number(property.deposit_percentage) / 100;
    const acceptedAt = new Date();
    const reservationResult = await client.query(
      `INSERT INTO reservations (
         property_id, customer_id, check_in, check_out, guest_count,
         total_amount, deposit_amount, terms_accepted, accepted_terms_version,
         accepted_at, accepted_ip, idempotency_key
       ) VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, true, $8, $9, $10, $11)
       ON CONFLICT (customer_id, idempotency_key) DO NOTHING
       RETURNING id, status, payment_status, check_in, check_out, total_amount, deposit_amount`,
      [input.propertyId, session.id, input.checkIn.toISOString(), input.checkOut.toISOString(), input.guestCount,
        totalAmount, depositAmount, property.terms_version, acceptedAt, request.ip, input.idempotencyKey]
    );

    if (!reservationResult.rowCount) {
      const existing = await client.query(
        `SELECT id, status, payment_status, check_in, check_out, total_amount, deposit_amount
         FROM reservations WHERE customer_id = $1 AND idempotency_key = $2`,
        [session.id, input.idempotencyKey]
      );
      await client.query('COMMIT');
      return { reservation: existing.rows[0] };
    }

    const reservation = reservationResult.rows[0];
    await client.query(
      `INSERT INTO inventory_blocks (property_id, reservation_id, source, blocked_period)
       VALUES (
         $1, $2, 'RESERVATION',
         tstzrange(
           ($3::date + $5::time) AT TIME ZONE $7,
           (($4::date + $6::time) AT TIME ZONE $7) + ($8::int * interval '1 hour'), '[)'
         )
       )`,
      [input.propertyId, reservation.id, input.checkIn.toISOString(), input.checkOut.toISOString(),
        property.check_in_time, property.check_out_time, property.timezone, property.cleaning_gap_hours]
    );
    await client.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'RESERVATION', $2, 'CREATED', $3)`,
      [session.id, reservation.id, JSON.stringify({ totalAmount, nights })]
    );
    await client.query('COMMIT');
    return reply.code(201).send({ reservation });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if ((error as { constraint?: string }).constraint === 'inventory_blocks_no_overlap') {
      return reply.code(409).send({ error: 'DATES_UNAVAILABLE' });
    }
    throw error;
  } finally {
    client.release();
  }
});

app.get('/reservations/mine', async (request, reply) => {
  let session;
  try {
    session = await requireUser(request);
  } catch {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }
  const result = await pool.query(
    `SELECT id, property_id, check_in, check_out, status, payment_status,
            guest_count, total_amount, deposit_amount, created_at
     FROM reservations WHERE customer_id = $1 ORDER BY check_in DESC`,
    [session.id]
  );
  return { reservations: result.rows };
});

app.get('/reservations/:reservationId', async (request, reply) => {
  let session;
  try {
    session = await requireUser(request);
  } catch {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }
  const params = z.object({ reservationId: z.string().uuid() }).parse(request.params);
  const result = await pool.query(
    `SELECT id, property_id, check_in, check_out, status, payment_status,
            guest_count, total_amount, deposit_amount, terms_accepted,
            accepted_terms_version, created_at, expires_at
     FROM reservations WHERE id = $1 AND customer_id = $2`,
    [params.reservationId, session.id]
  );
  if (!result.rowCount) return reply.code(404).send({ error: 'RESERVATION_NOT_FOUND' });
  return { reservation: result.rows[0] };
});

app.post('/payments/webhook', async (request, reply) => {
  const signature = request.headers['x-payment-webhook-secret'];
  if (typeof signature !== 'string') return reply.code(401).send({ error: 'INVALID_WEBHOOK_SIGNATURE' });
  const expected = Buffer.from(config.PAYMENT_WEBHOOK_SECRET);
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return reply.code(401).send({ error: 'INVALID_WEBHOOK_SIGNATURE' });
  }

  const input = z.object({
    provider: z.string().trim().min(2).max(40),
    eventId: z.string().trim().min(1).max(160),
    transactionId: z.string().trim().min(1).max(160),
    reservationId: z.string().uuid(),
    status: z.enum(['PAID', 'PARTIAL', 'FAILED', 'REFUNDED']),
    amount: z.number().nonnegative()
  }).parse(request.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query(
      `INSERT INTO payment_webhook_events (provider, provider_event_id, payload)
       VALUES ($1, $2, $3) ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [input.provider, input.eventId, JSON.stringify(input)]
    );
    if (!eventResult.rowCount) {
      await client.query('COMMIT');
      return { received: true, duplicate: true };
    }

    const reservationResult = await client.query(
      `SELECT id, status, payment_status FROM reservations WHERE id = $1 FOR UPDATE`,
      [input.reservationId]
    );
    if (!reservationResult.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'RESERVATION_NOT_FOUND' });
    }
    const nextReservationStatus = input.status === 'PAID' ? 'CONFIRMED' : input.status === 'FAILED' ? 'EXPIRED' : input.status === 'REFUNDED' ? 'CANCELLED' : reservationResult.rows[0].status;
    await client.query(
      `INSERT INTO payments (reservation_id, provider, provider_transaction_id, amount, status, paid_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 IN ('PAID', 'PARTIAL') THEN now() ELSE NULL END)
       ON CONFLICT (provider, provider_transaction_id) DO UPDATE SET status = EXCLUDED.status, paid_at = EXCLUDED.paid_at`,
      [input.reservationId, input.provider, input.transactionId, input.amount, input.status]
    );
    await client.query(
      `UPDATE reservations SET payment_status = $2, status = $3, updated_at = now()
       WHERE id = $1`,
      [input.reservationId, input.status, nextReservationStatus]
    );
    if (input.status === 'FAILED' || input.status === 'REFUNDED') {
      await client.query(`UPDATE inventory_blocks SET active = false WHERE reservation_id = $1 AND active = true`, [input.reservationId]);
    }
    await client.query(`UPDATE payment_webhook_events SET processed_at = now() WHERE id = $1`, [eventResult.rows[0].id]);
    await client.query('COMMIT');
    return { received: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.patch('/users/me', async (request, reply) => {
  let session;
  try {
    session = await requireUser(request);
  } catch {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }
  const input = z.object({
    fullName: z.string().trim().min(3).max(160).optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    documentNumber: z.string().trim().max(32).nullable().optional(),
    avatarUrl: z.string().url().max(2_000).nullable().optional()
  }).parse(request.body);
  const fields: string[] = [];
  const values: unknown[] = [session.id];
  for (const [field, column] of [
    ['fullName', 'full_name'],
    ['phone', 'phone'],
    ['documentNumber', 'document_number'],
    ['avatarUrl', 'avatar_url']
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      values.push(input[field]);
      fields.push(`${column} = $${values.length}`);
    }
  }
  if (!fields.length) return reply.code(400).send({ error: 'NO_FIELDS_TO_UPDATE' });
  const result = await pool.query(
    `UPDATE users SET ${fields.join(', ')}, updated_at = now()
     WHERE id = $1 AND status = 'ACTIVE'
     RETURNING id, email, full_name, phone, document_number, avatar_url, role`,
    values
  );
  if (!result.rowCount) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
  return { user: result.rows[0] };
});

app.post('/auth/register', async (request, reply) => {
  const input = z.object({
    email: z.string().email().transform((value) => value.toLowerCase()),
    password: z.string().min(12),
    fullName: z.string().trim().min(3).max(160)
  }).parse(request.body);

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, full_name, role`,
    [input.email, await hashPassword(input.password), input.fullName]
  );
  const user = result.rows[0];
  const token = await createSession(user.id, user.role);
  reply.setCookie('session', token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 15
  });
  return reply.code(201).send({ user });
});

app.post('/auth/login', async (request, reply) => {
  const input = z.object({ email: z.string().email(), password: z.string() }).parse(request.body);
  const result = await pool.query(
    `SELECT id, email, full_name, role, password_hash
     FROM users WHERE email = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
    [input.email.toLowerCase()]
  );
  const user = result.rows[0];
  if (!user || !(await verifyPassword(user.password_hash, input.password))) {
    return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
  }
  await pool.query('UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1', [user.id]);
  const token = await createSession(user.id, user.role);
  reply.setCookie('session', token, { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 15 });
  return { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role } };
});

app.post('/auth/logout', async (_request, reply) => {
  reply.clearCookie('session', { path: '/' });
  return { ok: true };
});

app.get('/auth/me', async (request, reply) => {
  try {
    const session = await requireUser(request);
    const result = await pool.query(
      'SELECT id, email, full_name, role, phone, document_number, avatar_url FROM users WHERE id = $1 AND status = \'ACTIVE\'',
      [session.id]
    );
    if (!result.rowCount) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    return { user: result.rows[0] };
  } catch {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: 'INVALID_INPUT', details: error.flatten() });
  app.log.error(error);
  return reply.code(500).send({ error: 'INTERNAL_ERROR' });
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });
