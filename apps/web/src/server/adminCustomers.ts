import { z } from 'zod';
import { query } from './db';
import { notFound } from './errors';
import { displayStatus } from './payment';

/**
 * Visão de cliente para o balcão: quem é, quanto já pagou, quantas vezes
 * ficou e o que está pendente. Contagens vêm de subconsultas em vez de join —
 * juntar reservas e pagamentos na mesma linha multiplicaria as duas.
 */

export const customerListSchema = z.object({
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export async function listCustomers(input: z.infer<typeof customerListSchema>) {
  const search = input.search ? `%${input.search.toLowerCase()}%` : null;

  const result = await query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.document_number, u.avatar_url,
            u.role, u.status, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM reservations r WHERE r.customer_id = u.id) AS reservas,
            (SELECT COUNT(*) FROM reservations r
              WHERE r.customer_id = u.id AND r.status IN ('CONFIRMED','COMPLETED')) AS estadias,
            (SELECT COUNT(*) FROM payments p JOIN reservations r ON r.id = p.reservation_id
              WHERE r.customer_id = u.id AND p.status IN ('PAID','PARTIAL')) AS pagamentos,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
               JOIN reservations r ON r.id = p.reservation_id
              WHERE r.customer_id = u.id AND p.status IN ('PAID','PARTIAL')) AS total_pago,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
               JOIN reservations r ON r.id = p.reservation_id
              WHERE r.customer_id = u.id AND p.status IN ('PENDING','PROCESSING')
                AND r.status IN ('PENDING_PAYMENT','CONFIRMED')) AS em_aberto,
            (SELECT COUNT(*) FROM payments p JOIN reservations r ON r.id = p.reservation_id
              WHERE r.customer_id = u.id AND p.status = 'PENDING'
                AND p.due_date < CURRENT_DATE
                AND r.status IN ('PENDING_PAYMENT','CONFIRMED')) AS atrasados,
            (SELECT MAX(r.check_out)::text FROM reservations r
              WHERE r.customer_id = u.id AND r.status IN ('CONFIRMED','COMPLETED')) AS ultima_estadia,
            (SELECT MIN(r.check_in)::text FROM reservations r
              WHERE r.customer_id = u.id AND r.status IN ('PENDING_PAYMENT','CONFIRMED')
                AND r.check_in >= CURRENT_DATE) AS proxima_estadia
     FROM users u
     WHERE u.deleted_at IS NULL
       AND ($1::text IS NULL OR lower(u.full_name) LIKE $1 OR lower(u.email) LIKE $1
            OR lower(COALESCE(u.phone,'')) LIKE $1 OR lower(COALESCE(u.document_number,'')) LIKE $1)
     ORDER BY u.created_at DESC
     LIMIT $2 OFFSET $3`,
    [search, input.limit, input.offset]
  );

  const total = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM users u
     WHERE u.deleted_at IS NULL
       AND ($1::text IS NULL OR lower(u.full_name) LIKE $1 OR lower(u.email) LIKE $1
            OR lower(COALESCE(u.phone,'')) LIKE $1 OR lower(COALESCE(u.document_number,'')) LIKE $1)`,
    [search]
  );

  return { customers: result.rows, total: Number(total.rows[0]?.total ?? 0) };
}

/** Ficha completa: perfil, estadias, cobranças e contratos. */
export async function customerDetail(customerId: string) {
  const perfil = await query(
    `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.document_number, u.rg,
            u.rg_issuer, u.nationality, u.marital_status, u.profession, u.address_line,
            u.address_city, u.address_state, u.address_zip, u.avatar_url, u.role,
            u.status, u.notes, u.created_at, u.last_login_at,
            -- Os totais viviam só na consulta da lista, e a tela de detalhe
            -- lia campos que não existiam: viravam "R$ NaN" na cara do
            -- operador. Mesmas regras dos dois lados, agora.
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
               JOIN reservations r ON r.id = p.reservation_id
              WHERE r.customer_id = u.id AND p.status IN ('PAID','PARTIAL')) AS total_pago,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
               JOIN reservations r ON r.id = p.reservation_id
              WHERE r.customer_id = u.id AND p.status IN ('PENDING','PROCESSING')
                AND r.status IN ('PENDING_PAYMENT','CONFIRMED')) AS em_aberto,
            (SELECT COUNT(*) FROM reservations r
              WHERE r.customer_id = u.id AND r.status IN ('CONFIRMED','COMPLETED')) AS estadias,
            (SELECT MAX(r.check_out)::text FROM reservations r
              WHERE r.customer_id = u.id AND r.status IN ('CONFIRMED','COMPLETED')) AS ultima_estadia
     FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [customerId]
  );
  if (!perfil.rowCount) throw notFound('CUSTOMER_NOT_FOUND');

  const [reservas, pagamentos, contratos] = await Promise.all([
    query(
      `SELECT r.id, r.check_in::text AS check_in, r.check_out::text AS check_out,
              r.status, r.payment_status, r.guest_count, r.total_amount, r.deposit_amount,
              r.created_at, r.checked_in_at, r.checked_out_at, r.staff_notes,
              COALESCE(p.short_name, p.name) AS unidade, p.color
       FROM reservations r JOIN properties p ON p.id = r.property_id
       WHERE r.customer_id = $1 ORDER BY r.check_in DESC`,
      [customerId]
    ),
    query(
      `SELECT p.id, p.reference, p.amount, p.status::text AS status, p.method, p.kind,
              p.installments, p.due_date::text AS due_date, p.paid_at, p.created_at,
              r.id AS reservation_id, r.check_in::text AS check_in
       FROM payments p JOIN reservations r ON r.id = p.reservation_id
       WHERE r.customer_id = $1 ORDER BY p.created_at DESC`,
      [customerId]
    ),
    query(
      `SELECT c.id, c.status::text AS status, c.template_version, c.signed_at,
              c.signature_hash, c.body_hash, r.id AS reservation_id,
              r.check_in::text AS check_in, r.check_out::text AS check_out
       FROM contracts c JOIN reservations r ON r.id = c.reservation_id
       WHERE r.customer_id = $1 ORDER BY c.created_at DESC`,
      [customerId]
    )
  ]);

  return {
    customer: perfil.rows[0],
    reservations: reservas.rows,
    payments: pagamentos.rows.map((row) => ({
      ...row,
      status: displayStatus(String(row.status), (row.due_date as string) ?? null),
      rawStatus: row.status
    })),
    contracts: contratos.rows
  };
}

export const customerNotesSchema = z.object({
  notes: z.string().trim().max(4000).nullable()
});

export async function saveCustomerNotes(
  customerId: string,
  input: z.infer<typeof customerNotesSchema>
) {
  const result = await query(
    `UPDATE users SET notes = $2, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING id, notes`,
    [customerId, input.notes]
  );
  if (!result.rowCount) throw notFound('CUSTOMER_NOT_FOUND');
  return result.rows[0];
}
