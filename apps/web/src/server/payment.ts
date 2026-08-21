import { z } from 'zod';
import { query, transaction, violatedConstraint } from './db';
import { badRequest, conflict, notFound } from './errors';
import { centsToNumeric } from './pricing';
import { buildPixPayload, paymentReference } from './pix';
import { findProperty } from './property';

export const webhookSchema = z.object({
  provider: z.string().trim().min(2).max(40),
  eventId: z.string().trim().min(1).max(160),
  transactionId: z.string().trim().min(1).max(160),
  reservationId: z.string().uuid(),
  status: z.enum(['PAID', 'PARTIAL', 'FAILED', 'REFUNDED']),
  amount: z.number().nonnegative()
});

export const confirmPaymentSchema = z.object({
  amount: z.number().positive(),
  status: z.enum(['PAID', 'PARTIAL']),
  note: z.string().trim().max(500).optional()
});

type ReservationForPayment = {
  id: string;
  property_id: string;
  status: string;
  payment_status: string;
  deposit_amount: string;
  total_amount: string;
  expires_at: string;
  check_in: string;
  check_out: string;
};

type PaymentRow = {
  id: string;
  reference: string;
  provider: string;
  amount: string;
  status: string;
};

// ---------------------------------------------------------------------------
// Cobranca do sinal - o elo que faltava entre "reserva criada" e "confirmada"
// ---------------------------------------------------------------------------

export async function createPaymentIntent(reservationId: string, customerId: string) {
  const found = await query<ReservationForPayment>(
    `SELECT id, property_id, status, payment_status,
            deposit_amount, total_amount, expires_at::text AS expires_at,
            check_in::text AS check_in, check_out::text AS check_out
     FROM reservations WHERE id = $1 AND customer_id = $2`,
    [reservationId, customerId]
  );
  const reservation = found.rows[0];
  if (!reservation) throw notFound('RESERVATION_NOT_FOUND');
  if (reservation.status === 'CANCELLED' || reservation.status === 'EXPIRED') {
    throw conflict('RESERVATION_NOT_PAYABLE');
  }
  if (reservation.payment_status === 'PAID') throw conflict('ALREADY_PAID');

  const property = await findProperty(reservation.property_id);
  if (!property.pix_key) throw conflict('PAYMENT_METHOD_NOT_CONFIGURED');

  const amountCents = Math.round(Number(reservation.deposit_amount) * 100);
  if (amountCents <= 0) throw conflict('NOTHING_TO_CHARGE');

  const payment = await ensurePendingPayment(reservation.id, amountCents);

  return {
    payment: {
      id: payment.id,
      reference: payment.reference,
      provider: payment.provider,
      amount: payment.amount,
      status: payment.status
    },
    pix: {
      key: property.pix_key,
      holderName: property.pix_holder_name ?? property.name,
      payload: buildPixPayload({
        key: property.pix_key,
        merchantName: property.pix_holder_name ?? property.name,
        amountCents,
        reference: payment.reference
      }),
      instructions: property.payment_instructions
    },
    reservation: {
      id: reservation.id,
      checkIn: reservation.check_in,
      checkOut: reservation.check_out,
      totalAmount: reservation.total_amount,
      depositAmount: reservation.deposit_amount,
      holdExpiresAt: reservation.expires_at
    }
  };
}

/**
 * Idempotente por construcao: o indice `payments_one_pending_per_reservation`
 * garante uma unica cobranca pendente por reserva, entao uma segunda chamada
 * devolve exatamente a mesma referencia (e o mesmo QR).
 */
async function ensurePendingPayment(reservationId: string, amountCents: number): Promise<PaymentRow> {
  const existing = await query<PaymentRow>(
    `SELECT id, reference, provider, amount, status FROM payments
     WHERE reservation_id = $1 AND status = 'PENDING'`,
    [reservationId]
  );
  if (existing.rows[0]?.reference) return existing.rows[0];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = paymentReference();
    try {
      const inserted = await query<PaymentRow>(
        `INSERT INTO payments (reservation_id, provider, amount, expected_amount, status, reference)
         VALUES ($1, 'MANUAL_PIX', $2, $2, 'PENDING', $3)
         RETURNING id, reference, provider, amount, status`,
        [reservationId, centsToNumeric(amountCents), reference]
      );
      return inserted.rows[0];
    } catch (error) {
      const constraint = violatedConstraint(error);
      if (constraint === 'payments_reference_unique') continue;
      if (constraint === 'payments_one_pending_per_reservation') {
        const raced = await query<PaymentRow>(
          `SELECT id, reference, provider, amount, status FROM payments
           WHERE reservation_id = $1 AND status = 'PENDING'`,
          [reservationId]
        );
        if (raced.rows[0]) return raced.rows[0];
      }
      throw error;
    }
  }
  throw conflict('COULD_NOT_ALLOCATE_REFERENCE');
}

// ---------------------------------------------------------------------------
// Liquidacao
// ---------------------------------------------------------------------------

/**
 * Traduz o status do pagamento para o estado da reserva.
 *
 * `PARTIAL` e o caso que estava quebrado: mantinha a reserva em
 * PENDING_PAYMENT e o varredor de holds a expirava, liberando a data de quem
 * ja havia pagado o sinal. Agora o hold e estendido e o varredor ignora
 * reservas com pagamento registrado.
 */
export function nextReservationStatus(
  paymentStatus: 'PAID' | 'PARTIAL' | 'FAILED' | 'REFUNDED',
  current: string
): string {
  switch (paymentStatus) {
    case 'PAID':
      return 'CONFIRMED';
    case 'PARTIAL':
      return current === 'PENDING_PAYMENT' ? 'PENDING_PAYMENT' : current;
    case 'FAILED':
      return 'EXPIRED';
    case 'REFUNDED':
      return 'CANCELLED';
  }
}

export async function settlePayment(input: {
  reservationId: string;
  provider: string;
  transactionId: string | null;
  reference?: string | null;
  status: 'PAID' | 'PARTIAL' | 'FAILED' | 'REFUNDED';
  amount: number;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return transaction(async (client) => {
    const found = await client.query<ReservationForPayment>(
      `SELECT id, property_id, status, payment_status, deposit_amount, total_amount,
              expires_at::text AS expires_at, check_in::text AS check_in, check_out::text AS check_out
       FROM reservations WHERE id = $1 FOR UPDATE`,
      [input.reservationId]
    );
    const reservation = found.rows[0];
    if (!reservation) throw notFound('RESERVATION_NOT_FOUND');

    const nextStatus = nextReservationStatus(input.status, reservation.status);

    // Fecha a cobranca pendente, se houver, em vez de criar linha orfa.
    const pending = await client.query<{ id: string }>(
      `SELECT id FROM payments WHERE reservation_id = $1 AND status = 'PENDING'
       ORDER BY created_at LIMIT 1`,
      [input.reservationId]
    );

    if (pending.rows[0]) {
      await client.query(
        `UPDATE payments
         SET status = $2, provider = $3,
             provider_transaction_id = COALESCE($4, provider_transaction_id),
             amount = $5,
             paid_at = CASE WHEN $2 IN ('PAID', 'PARTIAL') THEN now() ELSE NULL END,
             updated_at = now()
         WHERE id = $1`,
        [
          pending.rows[0].id,
          input.status,
          input.provider,
          input.transactionId,
          input.amount.toFixed(2)
        ]
      );
    } else {
      await client.query(
        `INSERT INTO payments (reservation_id, provider, provider_transaction_id, amount, status, paid_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 IN ('PAID','PARTIAL') THEN now() ELSE NULL END)
         ON CONFLICT (provider, provider_transaction_id)
           DO UPDATE SET status = EXCLUDED.status, paid_at = EXCLUDED.paid_at, updated_at = now()`,
        [
          input.reservationId,
          input.provider,
          input.transactionId,
          input.amount.toFixed(2),
          input.status
        ]
      );
    }

    if (input.status === 'PARTIAL') {
      // Dinheiro entrou: o hold deixa de ter prazo de 30 minutos.
      await client.query(
        `UPDATE reservations
         SET payment_status = 'PARTIAL', status = $2,
             expires_at = GREATEST(expires_at, (check_in::timestamptz - interval '1 day')),
             updated_at = now()
         WHERE id = $1`,
        [input.reservationId, nextStatus]
      );
    } else {
      await client.query(
        `UPDATE reservations SET payment_status = $2, status = $3, updated_at = now() WHERE id = $1`,
        [input.reservationId, input.status, nextStatus]
      );
    }

    if (input.status === 'FAILED' || input.status === 'REFUNDED') {
      await client.query(
        `UPDATE inventory_blocks SET active = false WHERE reservation_id = $1 AND active = true`,
        [input.reservationId]
      );
    }

    await client.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'RESERVATION', $2, $3, $4)`,
      [
        input.actorUserId ?? null,
        input.reservationId,
        `PAYMENT_${input.status}`,
        JSON.stringify({
          provider: input.provider,
          transactionId: input.transactionId,
          reference: input.reference ?? null,
          amount: input.amount,
          ...input.metadata
        })
      ]
    );

    return { reservationId: input.reservationId, status: nextStatus, paymentStatus: input.status };
  });
}

/** Registra um webhook antes de processa-lo. `null` = evento repetido. */
export async function claimWebhookEvent(provider: string, eventId: string, payload: unknown) {
  const result = await query<{ id: string }>(
    `INSERT INTO payment_webhook_events (provider, provider_event_id, payload)
     VALUES ($1, $2, $3) ON CONFLICT (provider, provider_event_id) DO NOTHING
     RETURNING id`,
    [provider, eventId, JSON.stringify(payload)]
  );
  return result.rows[0]?.id ?? null;
}

export async function markWebhookProcessed(id: string) {
  await query(`UPDATE payment_webhook_events SET processed_at = now() WHERE id = $1`, [id]);
}

export async function findPaymentByReference(reference: string) {
  const result = await query<{ reservation_id: string; expected_amount: string | null }>(
    `SELECT reservation_id, expected_amount FROM payments WHERE reference = $1`,
    [reference.trim().toUpperCase()]
  );
  const payment = result.rows[0];
  if (!payment) throw badRequest('PAYMENT_REFERENCE_NOT_FOUND');
  return payment;
}
