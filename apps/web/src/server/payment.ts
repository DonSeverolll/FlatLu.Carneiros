import { z } from 'zod';
import type { PoolClient } from 'pg';
import { query, transaction, violatedConstraint } from './db';
import { AppError, badRequest, conflict, notFound } from './errors';
import { todayIso } from './dates';
import { centsToNumeric } from './pricing';
import { buildPixPayload, paymentReference } from './pix';
import { findProperty } from './property';
import {
  CARD_PROVIDER,
  cardProviderConfigured,
  createCardCheckout,
  createPixCharge,
  fetchProviderPayment,
  pixProviderConfigured,
  translateProviderMethod,
  translateProviderStatus
} from './paymentProvider';
import { syncLeadFromReservation } from './crm';

export const webhookSchema = z.object({
  provider: z.string().trim().min(2).max(40),
  eventId: z.string().trim().min(1).max(160),
  transactionId: z.string().trim().min(1).max(160),
  reservationId: z.string().uuid(),
  status: z.enum(['PAID', 'PARTIAL', 'FAILED', 'REFUNDED', 'PROCESSING', 'DECLINED', 'CANCELLED']),
  amount: z.number().nonnegative()
});

export const confirmPaymentSchema = z.object({
  amount: z.number().positive(),
  status: z.enum(['PAID', 'PARTIAL']),
  method: z.enum(['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH', 'TRANSFER']).optional(),
  note: z.string().trim().max(500).optional()
});

export const paymentIntentSchema = z.object({
  method: z.enum(['PIX', 'CREDIT_CARD', 'DEBIT_CARD']).default('PIX'),
  installments: z.number().int().min(1).max(12).default(1),
  /** DEPOSIT = sinal; BALANCE = saldo; FULL = à vista. */
  kind: z.enum(['DEPOSIT', 'BALANCE', 'FULL']).default('DEPOSIT')
});

export type SettlementStatus =
  | 'PAID' | 'PARTIAL' | 'FAILED' | 'REFUNDED' | 'PROCESSING' | 'DECLINED' | 'CANCELLED';

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
  customer_name: string;
  customer_email: string;
  customer_document: string | null;
  contract_status: string | null;
};

type PaymentRow = {
  id: string;
  reference: string;
  provider: string;
  amount: string;
  status: string;
  method: string;
  kind: string;
  installments: number;
  due_date: string | null;
  checkout_url: string | null;
};

const PAYMENT_COLUMNS =
  'id, reference, provider, amount, status, method, kind, installments, due_date::text AS due_date, checkout_url';

/**
 * "Em atraso" é derivado, nunca gravado: é uma cobrança pendente cujo
 * vencimento passou. Guardar como estado exigiria um processo mantendo a
 * tabela verdadeira, e ela ficaria errada entre uma varredura e outra.
 */
export function displayStatus(status: string, dueDate: string | null): string {
  if ((status === 'PENDING' || status === 'PROCESSING') && dueDate && dueDate < todayIso()) {
    return 'OVERDUE';
  }
  return status;
}

// ---------------------------------------------------------------------------
// Cobranca
// ---------------------------------------------------------------------------

async function loadReservation(reservationId: string, customerId: string) {
  const found = await query<ReservationForPayment>(
    `SELECT r.id, r.property_id, r.status, r.payment_status,
            r.deposit_amount, r.total_amount, r.expires_at::text AS expires_at,
            r.check_in::text AS check_in, r.check_out::text AS check_out,
            u.full_name AS customer_name, u.email AS customer_email,
            u.document_number AS customer_document,
            (SELECT c.status::text FROM contracts c
              WHERE c.reservation_id = r.id AND c.status <> 'CANCELLED') AS contract_status
     FROM reservations r JOIN users u ON u.id = r.customer_id
     WHERE r.id = $1 AND r.customer_id = $2`,
    [reservationId, customerId]
  );
  const reservation = found.rows[0];
  if (!reservation) throw notFound('RESERVATION_NOT_FOUND');
  return reservation;
}

function amountForKind(reservation: ReservationForPayment, kind: string): number {
  const totalCents = Math.round(Number(reservation.total_amount) * 100);
  const depositCents = Math.round(Number(reservation.deposit_amount) * 100);
  if (kind === 'FULL') return totalCents;
  if (kind === 'BALANCE') return totalCents - depositCents;
  return depositCents;
}

export async function createPaymentIntent(
  reservationId: string,
  customerId: string,
  input: z.infer<typeof paymentIntentSchema> = { method: 'PIX', installments: 1, kind: 'DEPOSIT' },
  origin?: string
) {
  const reservation = await loadReservation(reservationId, customerId);

  if (reservation.status === 'CANCELLED' || reservation.status === 'EXPIRED') {
    throw conflict('RESERVATION_NOT_PAYABLE');
  }
  if (reservation.payment_status === 'PAID') throw conflict('ALREADY_PAID');

  // Contrato antes do dinheiro: é a ordem que o próprio instrumento define,
  // já que a Cláusula Quarta condiciona a reserva à aprovação da entrada.
  if (reservation.contract_status !== 'SIGNED') {
    throw new AppError(409, 'CONTRACT_NOT_SIGNED', { contractStatus: reservation.contract_status });
  }

  if (input.kind === 'BALANCE' && reservation.payment_status === 'PENDING') {
    throw conflict('DEPOSIT_NOT_PAID');
  }

  const property = await findProperty(reservation.property_id);
  const amountCents = amountForKind(reservation, input.kind);
  if (amountCents <= 0) throw conflict('NOTHING_TO_CHARGE');

  // O saldo vence no check-in; o sinal, quando o hold expira.
  const dueDate = input.kind === 'BALANCE' ? reservation.check_in : todayIso(property.timezone);

  if (input.method === 'PIX') {
    /**
     * Com credencial do provedor o Pix é dinâmico: QR com valor, vencimento e
     * webhook próprios — é o que permite dar baixa sozinho. Sem ela, cai no BR
     * Code estático da chave do imóvel, que continua funcionando mas exige
     * conferência no extrato.
     */
    if (pixProviderConfigured()) {
      const payment = await ensurePayment(reservation.id, {
        amountCents,
        kind: input.kind,
        method: 'PIX',
        provider: CARD_PROVIDER,
        installments: 1,
        dueDate
      });
      const pix = await ensurePixCharge(payment, {
        description: `${property.short_name ?? property.name} · ${reservation.check_in} a ${reservation.check_out}`,
        amountCents,
        payer: {
          name: reservation.customer_name,
          email: reservation.customer_email,
          document: reservation.customer_document
        },
        notificationUrl: `${origin ?? ''}/api/payments/mercadopago`
      });
      return {
        payment: publicPayment({ ...payment, provider: CARD_PROVIDER }),
        pix: {
          key: null,
          holderName: property.pix_holder_name ?? property.name,
          payload: pix.payload,
          qrCodeBase64: pix.qrCodeBase64,
          expiresAt: pix.expiresAt,
          automatic: true,
          instructions: property.payment_instructions
        },
        card: null,
        reservation: reservationSummary(reservation, property, amountCents)
      };
    }

    if (!property.pix_key) throw conflict('PAYMENT_METHOD_NOT_CONFIGURED');
    const payment = await ensurePayment(reservation.id, {
      amountCents, kind: input.kind, method: 'PIX', provider: 'MANUAL_PIX', installments: 1, dueDate
    });
    return {
      payment: publicPayment(payment),
      pix: {
        key: property.pix_key,
        holderName: property.pix_holder_name ?? property.name,
        payload: buildPixPayload({
          key: property.pix_key,
          merchantName: property.pix_holder_name ?? property.name,
          amountCents,
          reference: payment.reference
        }),
        qrCodeBase64: null,
        expiresAt: null,
        automatic: false,
        instructions: property.payment_instructions
      },
      card: null,
      reservation: reservationSummary(reservation, property, amountCents)
    };
  }

  // ---- cartão ------------------------------------------------------------
  if (!cardProviderConfigured()) {
    throw new AppError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', { provider: CARD_PROVIDER });
  }
  const base = origin ?? '';
  const payment = await ensurePayment(reservation.id, {
    amountCents,
    kind: input.kind,
    method: input.method,
    provider: CARD_PROVIDER,
    installments: input.method === 'DEBIT_CARD' ? 1 : input.installments,
    dueDate
  });

  const checkout = await createCardCheckout({
    reference: payment.reference,
    description: `${property.short_name ?? property.name} · ${reservation.check_in} a ${reservation.check_out}`,
    amountCents,
    installments: input.method === 'DEBIT_CARD' ? 1 : input.installments,
    payer: {
      name: reservation.customer_name,
      email: reservation.customer_email,
      document: reservation.customer_document
    },
    successUrl: `${base}/reserva/${reservation.id}?pagamento=aprovado`,
    failureUrl: `${base}/reserva/${reservation.id}?pagamento=recusado`,
    pendingUrl: `${base}/reserva/${reservation.id}?pagamento=processando`,
    notificationUrl: `${base}/api/payments/webhook`
  });

  await query(
    `UPDATE payments SET checkout_url = $2, provider_transaction_id = $3, updated_at = now()
     WHERE id = $1`,
    [payment.id, checkout.checkoutUrl, checkout.providerReference]
  );

  return {
    payment: { ...publicPayment(payment), checkoutUrl: checkout.checkoutUrl },
    pix: null,
    card: { provider: checkout.provider, checkoutUrl: checkout.checkoutUrl },
    reservation: reservationSummary(reservation, property, amountCents)
  };
}

function publicPayment(payment: PaymentRow) {
  return {
    id: payment.id,
    reference: payment.reference,
    provider: payment.provider,
    amount: payment.amount,
    status: displayStatus(payment.status, payment.due_date),
    rawStatus: payment.status,
    method: payment.method,
    kind: payment.kind,
    installments: payment.installments,
    dueDate: payment.due_date,
    checkoutUrl: payment.checkout_url
  };
}

function reservationSummary(
  reservation: ReservationForPayment,
  property: { short_name?: string | null; name: string; color?: string | null; location_name?: string | null },
  amountCents: number
) {
  return {
    id: reservation.id,
    checkIn: reservation.check_in,
    checkOut: reservation.check_out,
    totalAmount: reservation.total_amount,
    depositAmount: reservation.deposit_amount,
    chargeAmount: centsToNumeric(amountCents),
    holdExpiresAt: reservation.expires_at,
    unitName: property.short_name ?? property.name,
    unitColor: property.color ?? null,
    unitLocation: property.location_name ?? null
  };
}

/**
 * Idempotente por construção: o índice `payments_one_open_per_kind` garante
 * uma cobrança aberta por (reserva, tipo), então repetir a chamada devolve a
 * mesma referência — e, no Pix, o mesmo QR.
 */
/**
 * QR do Pix dinâmico, criando um novo só quando preciso.
 *
 * Reabrir a página de pagamento não pode gerar cobrança nova a cada visita: o
 * hóspede acabaria com vários QR válidos para a mesma diária e o extrato
 * viraria um quebra-cabeça. Enquanto o QR guardado não venceu, ele é
 * devolvido como está.
 */
async function ensurePixCharge(
  payment: PaymentRow,
  input: {
    description: string;
    amountCents: number;
    payer: { name: string; email: string; document?: string | null };
    notificationUrl: string;
  }
) {
  const guardado = await query<{
    pix_payload: string | null;
    pix_qr_base64: string | null;
    pix_expires_at: string | null;
  }>(
    `SELECT pix_payload, pix_qr_base64, pix_expires_at::text AS pix_expires_at
       FROM payments WHERE id = $1`,
    [payment.id]
  );

  const atual = guardado.rows[0];
  const aindaVale =
    atual?.pix_payload &&
    (!atual.pix_expires_at || Date.parse(atual.pix_expires_at) > Date.now() + 60_000);

  if (aindaVale) {
    return {
      payload: atual.pix_payload!,
      qrCodeBase64: atual.pix_qr_base64,
      expiresAt: atual.pix_expires_at
    };
  }

  const cobranca = await createPixCharge({
    reference: payment.reference,
    description: input.description,
    amountCents: input.amountCents,
    payer: input.payer,
    notificationUrl: input.notificationUrl,
    // O QR vence junto com o dia; o hold da reserva é quem manda no prazo curto.
    expiresInMinutes: 60 * 24
  });

  await query(
    `UPDATE payments
        SET provider = $2,
            provider_transaction_id = $3,
            provider_status = $4,
            pix_payload = $5,
            pix_qr_base64 = $6,
            pix_expires_at = $7,
            updated_at = now()
      WHERE id = $1`,
    [
      payment.id,
      cobranca.provider,
      cobranca.providerPaymentId,
      cobranca.status,
      cobranca.payload,
      cobranca.qrCodeBase64,
      cobranca.expiresAt
    ]
  );

  return {
    payload: cobranca.payload,
    qrCodeBase64: cobranca.qrCodeBase64,
    expiresAt: cobranca.expiresAt
  };
}

async function ensurePayment(
  reservationId: string,
  input: {
    amountCents: number;
    kind: string;
    method: string;
    provider: string;
    installments: number;
    dueDate: string;
  }
): Promise<PaymentRow> {
  const existing = await query<PaymentRow>(
    `SELECT ${PAYMENT_COLUMNS} FROM payments
     WHERE reservation_id = $1 AND kind = $2 AND status IN ('PENDING', 'PROCESSING')`,
    [reservationId, input.kind]
  );
  const current = existing.rows[0];
  if (current) {
    // Trocar de método na mesma cobrança é normal: o hóspede muda de ideia.
    if (current.method !== input.method) {
      const updated = await query<PaymentRow>(
        `UPDATE payments SET method = $2, provider = $3, installments = $4,
                             checkout_url = NULL, updated_at = now()
         WHERE id = $1 RETURNING ${PAYMENT_COLUMNS}`,
        [current.id, input.method, input.provider, input.installments]
      );
      return updated.rows[0]!;
    }
    return current;
  }

  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const reference = paymentReference();
    try {
      const inserted = await query<PaymentRow>(
        `INSERT INTO payments (reservation_id, provider, amount, expected_amount, status,
                               reference, method, kind, installments, due_date)
         VALUES ($1, $2, $3, $3, 'PENDING', $4, $5, $6, $7, $8::date)
         RETURNING ${PAYMENT_COLUMNS}`,
        [
          reservationId,
          input.provider,
          centsToNumeric(input.amountCents),
          reference,
          input.method,
          input.kind,
          input.installments,
          input.dueDate
        ]
      );
      return inserted.rows[0]!;
    } catch (error) {
      const constraint = violatedConstraint(error);
      if (constraint === 'payments_reference_unique') continue;
      if (constraint === 'payments_one_open_per_kind') {
        const raced = await query<PaymentRow>(
          `SELECT ${PAYMENT_COLUMNS} FROM payments
           WHERE reservation_id = $1 AND kind = $2 AND status IN ('PENDING', 'PROCESSING')`,
          [reservationId, input.kind]
        );
        if (raced.rows[0]) return raced.rows[0];
      }
      throw error;
    }
  }
  throw conflict('COULD_NOT_ALLOCATE_REFERENCE');
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Extrato do hóspede: toda cobrança dele, em qualquer espaço. */
export async function paymentsForCustomer(customerId: string) {
  const result = await query(
    `SELECT p.id, p.reference, p.amount, p.status::text AS status, p.method, p.kind,
            p.installments, p.due_date::text AS due_date, p.paid_at, p.created_at,
            p.checkout_url, p.failure_reason,
            r.id AS reservation_id, r.check_in::text AS check_in, r.check_out::text AS check_out,
            prop.slug AS unit_slug, COALESCE(prop.short_name, prop.name) AS unit_name,
            prop.color AS unit_color
     FROM payments p
     JOIN reservations r ON r.id = p.reservation_id
     JOIN properties prop ON prop.id = r.property_id
     WHERE r.customer_id = $1
     ORDER BY p.created_at DESC`,
    [customerId]
  );
  return result.rows.map((row) => ({
    ...row,
    status: displayStatus(String(row.status), (row.due_date as string) ?? null),
    rawStatus: row.status
  }));
}

export async function paymentsForReservation(reservationId: string) {
  const result = await query(
    `SELECT ${PAYMENT_COLUMNS}, paid_at, created_at, failure_reason
     FROM payments WHERE reservation_id = $1 ORDER BY created_at`,
    [reservationId]
  );
  return result.rows.map((row) => ({
    ...row,
    status: displayStatus(String(row.status), (row.due_date as string) ?? null),
    rawStatus: row.status
  }));
}

// ---------------------------------------------------------------------------
// Liquidacao
// ---------------------------------------------------------------------------

/**
 * Traduz o status do pagamento para o estado da reserva.
 *
 * `PARTIAL` é o caso que já esteve quebrado: mantinha a reserva em
 * PENDING_PAYMENT e o varredor de holds a expirava, liberando a data de quem
 * já havia pagado o sinal.
 */
export function nextReservationStatus(paymentStatus: SettlementStatus, current: string): string {
  switch (paymentStatus) {
    case 'PAID':
      return 'CONFIRMED';
    case 'PARTIAL':
      return current === 'PENDING_PAYMENT' ? 'PENDING_PAYMENT' : current;
    case 'PROCESSING':
      return current;
    case 'FAILED':
    case 'DECLINED':
      return 'EXPIRED';
    case 'REFUNDED':
    case 'CANCELLED':
      return 'CANCELLED';
  }
}

/** Estados em que a data volta para o calendário. */
const RELEASES_INVENTORY: SettlementStatus[] = ['FAILED', 'DECLINED', 'REFUNDED', 'CANCELLED'];

/** Estados em que o dinheiro entrou e a data tem de estar segurada. */
const HOLDS_INVENTORY: SettlementStatus[] = ['PAID', 'PARTIAL'];

/**
 * Garante que uma reserva paga tenha a data travada no calendário.
 *
 * O caso que motivou isto: uma reserva cujo hold expirou perde o bloqueio, e
 * o hóspede paga depois — por fora, ou pelo link que ficou aberto. Sem esta
 * etapa a reserva voltava a CONFIRMED com as noites livres para venda, e o
 * overbooking só apareceria quando o segundo hóspede chegasse na porta.
 *
 * Se alguém já tiver comprado essas noites nesse intervalo, a restrição de
 * exclusão recusa e o erro sobe explícito: quem confirmou precisa saber que a
 * data foi vendida, não descobrir depois.
 */
async function reblockInventory(client: PoolClient, reservationId: string) {
  const jaTem = await client.query(
    `SELECT 1 FROM inventory_blocks WHERE reservation_id = $1 AND active = true`,
    [reservationId]
  );
  if (jaTem.rowCount) return;

  try {
    await client.query(
      `INSERT INTO inventory_blocks (property_id, reservation_id, source, blocked_nights)
       SELECT r.property_id, r.id, 'RESERVATION',
              daterange(r.check_in, r.check_out + p.cleaning_gap_days::int, '[)')
         FROM reservations r JOIN properties p ON p.id = r.property_id
        WHERE r.id = $1`,
      [reservationId]
    );
  } catch (error) {
    if (violatedConstraint(error) === 'inventory_blocks_no_overlap') {
      throw conflict('DATES_TAKEN_MEANWHILE');
    }
    throw error;
  }
}

export async function settlePayment(input: {
  reservationId: string;
  provider: string;
  transactionId: string | null;
  reference?: string | null;
  status: SettlementStatus;
  amount: number;
  method?: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return transaction(async (client) => {
    const found = await client.query<{ id: string; status: string; payment_status: string }>(
      `SELECT id, status, payment_status FROM reservations WHERE id = $1 FOR UPDATE`,
      [input.reservationId]
    );
    const reservation = found.rows[0];
    if (!reservation) throw notFound('RESERVATION_NOT_FOUND');

    const nextStatus = nextReservationStatus(input.status, reservation.status);

    const pending = await client.query<{ id: string }>(
      `SELECT id FROM payments
       WHERE reservation_id = $1 AND status IN ('PENDING', 'PROCESSING')
       ORDER BY created_at LIMIT 1`,
      [input.reservationId]
    );

    if (pending.rows[0]) {
      await client.query(
        `UPDATE payments
         SET status = $2::payment_status, provider = $3,
             provider_transaction_id = COALESCE($4, provider_transaction_id),
             amount = $5, method = COALESCE($6, method),
             paid_at = CASE WHEN $2::payment_status IN ('PAID', 'PARTIAL')
                            THEN now() ELSE NULL END,
             updated_at = now()
         WHERE id = $1`,
        [
          pending.rows[0].id,
          input.status,
          input.provider,
          input.transactionId,
          input.amount.toFixed(2),
          input.method ?? null
        ]
      );
    } else {
      /**
       * Cobrança nascida da conciliação — pagamento que entrou sem passar pela
       * tela. Precisa de referência própria: é por ela que a tela de clientes
       * e o extrato identificam a linha, e sem ela a coluna aparecia vazia.
       */
      await client.query(
        `INSERT INTO payments (reservation_id, provider, provider_transaction_id, amount,
                               status, method, reference, paid_at)
         SELECT $1, $2, $3, $4, $5::payment_status, COALESCE($6, 'PIX'),
                COALESCE($7, $8),
                CASE WHEN $5::payment_status IN ('PAID','PARTIAL') THEN now() ELSE NULL END
         -- Confirmar o mesmo valor duas vezes não pode virar duas cobranças:
         -- o total pago do cliente dobraria. Valores diferentes seguem
         -- entrando, que é o caso legítimo de sinal e saldo.
         WHERE NOT EXISTS (
           SELECT 1 FROM payments existente
            WHERE existente.reservation_id = $1
              AND existente.status = $5::payment_status
              AND existente.amount = $4::numeric
         )
         ON CONFLICT (provider, provider_transaction_id)
           WHERE provider_transaction_id IS NOT NULL
           DO UPDATE SET status = EXCLUDED.status, paid_at = EXCLUDED.paid_at, updated_at = now()`,
        [
          input.reservationId,
          input.provider,
          input.transactionId,
          input.amount.toFixed(2),
          input.status,
          input.method ?? null,
          input.reference ?? null,
          paymentReference()
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
    } else if (input.status === 'PROCESSING') {
      await client.query(
        `UPDATE reservations
         SET expires_at = GREATEST(expires_at, now() + interval '2 days'), updated_at = now()
         WHERE id = $1`,
        [input.reservationId]
      );
    } else {
      await client.query(
        `UPDATE reservations SET payment_status = $2::payment_status, status = $3, updated_at = now()
         WHERE id = $1`,
        [input.reservationId, input.status, nextStatus]
      );
    }

    if (RELEASES_INVENTORY.includes(input.status)) {
      await client.query(
        `UPDATE inventory_blocks SET active = false WHERE reservation_id = $1 AND active = true`,
        [input.reservationId]
      );
    } else if (HOLDS_INVENTORY.includes(input.status)) {
      await reblockInventory(client, input.reservationId);
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

    await syncLeadFromReservation(input.reservationId, client);

    return { reservationId: input.reservationId, status: nextStatus, paymentStatus: input.status };
  });
}

/** Registra um webhook antes de processá-lo. `null` = evento repetido. */
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

// ---------------------------------------------------------------------------
// Baixa automática a partir do provedor
// ---------------------------------------------------------------------------

/**
 * Traduz o estado do provedor para o nosso, levando em conta o que a cobrança
 * representa.
 *
 * O provedor só sabe dizer "aprovado". Se aquilo era o sinal, a reserva fica
 * parcialmente paga; se era o saldo ou a diária inteira, fica quitada. Sem
 * essa distinção um sinal de 50% marcaria a estadia como paga e o saldo nunca
 * seria cobrado.
 */
function settlementFor(providerStatus: string, kind: string): SettlementStatus | null {
  const nosso = translateProviderStatus(providerStatus);
  if (nosso === 'PAID') return kind === 'DEPOSIT' ? 'PARTIAL' : 'PAID';
  if (nosso === 'PENDING') return null; // Ainda não aconteceu nada; não mexe.
  return nosso as SettlementStatus;
}

export type ProviderSettlement =
  | { outcome: 'SETTLED'; reservationId: string; status: SettlementStatus; amount: number }
  | { outcome: 'IGNORED'; reason: string };

/**
 * Dá baixa em uma cobrança a partir do id do provedor.
 *
 * O estado NUNCA vem de quem chamou: é lido na API do provedor toda vez. Uma
 * notificação forjada consegue, no máximo, nos fazer consultar um pagamento
 * que existe — jamais declarar pago o que não foi.
 */
export async function settleFromProvider(
  providerPaymentId: string,
  actorUserId: string | null = null,
  origem = 'WEBHOOK'
): Promise<ProviderSettlement> {
  const remoto = await fetchProviderPayment(providerPaymentId);
  if (!remoto) return { outcome: 'IGNORED', reason: 'PAGAMENTO_INEXISTENTE' };

  // A cobrança é localizada pelo id do provedor ou pela nossa referência, que
  // vai como external_reference. O segundo caminho cobre o Pix criado antes de
  // o id ter sido gravado.
  const local = await query<{
    id: string;
    reservation_id: string;
    kind: string;
    status: string;
    reference: string;
  }>(
    `SELECT id, reservation_id, kind, status::text AS status, reference
       FROM payments
      WHERE provider_transaction_id = $1
         OR ($2::text IS NOT NULL AND reference = $2)
      ORDER BY (provider_transaction_id = $1) DESC
      LIMIT 1`,
    [remoto.id, remoto.externalReference]
  );

  const cobranca = local.rows[0];
  if (!cobranca) return { outcome: 'IGNORED', reason: 'COBRANCA_NAO_ENCONTRADA' };

  const status = settlementFor(remoto.status, cobranca.kind);
  if (!status) return { outcome: 'IGNORED', reason: 'AINDA_PENDENTE' };

  // Já estava no estado final que o provedor informa: nada a fazer. Evita
  // regravar e reemitir evento a cada reenvio de notificação.
  const jaFinal =
    (status === 'PAID' && cobranca.status === 'PAID') ||
    (status === 'PARTIAL' && cobranca.status === 'PARTIAL');
  if (jaFinal) return { outcome: 'IGNORED', reason: 'JA_CONCILIADO' };

  await query(
    `UPDATE payments
        SET provider_transaction_id = COALESCE(provider_transaction_id, $2),
            provider_status = $3,
            failure_reason = $4,
            updated_at = now()
      WHERE id = $1`,
    [cobranca.id, remoto.id, remoto.status, remoto.statusDetail]
  );

  await settlePayment({
    reservationId: cobranca.reservation_id,
    provider: CARD_PROVIDER,
    transactionId: remoto.id,
    reference: cobranca.reference,
    status,
    amount: remoto.amount,
    method: translateProviderMethod(remoto),
    actorUserId,
    metadata: {
      source: origem,
      providerStatus: remoto.status,
      statusDetail: remoto.statusDetail,
      approvedAt: remoto.approvedAt
    }
  });

  return {
    outcome: 'SETTLED',
    reservationId: cobranca.reservation_id,
    status,
    amount: remoto.amount
  };
}

/**
 * Varre as cobranças em aberto e pergunta ao provedor como elas estão.
 *
 * Webhook é o mecanismo principal, este é a rede de segurança: notificação se
 * perde — deploy no ar na hora errada, instabilidade, endpoint mal
 * configurado — e sem isto a reserva ficaria pendente com o dinheiro já na
 * conta, expirando sozinha.
 */
export async function reconcilePendingPayments(limite = 40) {
  if (!pixProviderConfigured()) return { checked: 0, settled: 0, results: [] as unknown[] };

  const abertas = await query<{ provider_transaction_id: string; reference: string }>(
    `SELECT provider_transaction_id, reference
       FROM payments
      WHERE status IN ('PENDING', 'PROCESSING')
        AND provider = $1
        AND provider_transaction_id IS NOT NULL
        AND created_at > now() - interval '30 days'
      ORDER BY created_at DESC
      LIMIT $2`,
    [CARD_PROVIDER, limite]
  );

  const resultados: unknown[] = [];
  let conciliadas = 0;

  for (const linha of abertas.rows) {
    try {
      const r = await settleFromProvider(linha.provider_transaction_id, null, 'RECONCILIACAO');
      if (r.outcome === 'SETTLED') conciliadas += 1;
      resultados.push({ reference: linha.reference, ...r });
    } catch (error) {
      // Uma cobrança problemática não pode interromper a varredura das outras.
      console.error('[conciliacao] falhou para', linha.reference, error);
      resultados.push({ reference: linha.reference, outcome: 'ERRO' });
    }
  }

  return { checked: abertas.rowCount ?? 0, settled: conciliadas, results: resultados };
}
