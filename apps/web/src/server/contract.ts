import { createHash } from 'node:crypto';
import { z } from 'zod';
import { query, transaction } from './db';
import { AppError, badRequest, conflict, notFound } from './errors';
import { syncLeadFromReservation } from './crm';
import {
  dataPorExtenso,
  moedaBRL,
  numeroPorExtenso,
  preencherModelo,
  valorPorExtenso
} from './contractText';

/**
 * Emissão e assinatura do contrato de locação por temporada.
 *
 * O que isto é: assinatura eletrônica SIMPLES, nos termos do art. 4º, I, da
 * Lei 14.063/2020 — aceite registrado com identificação do signatário, IP,
 * instante e hash do texto. Vale entre as partes para este tipo de contrato.
 *
 * O que isto NÃO é: assinatura qualificada ICP-Brasil nem Gov.br. Se o
 * escritório quiser esse nível, o caminho é exportar o PDF e assiná-lo lá — o
 * `external_url` do registro existe para guardar esse retorno.
 */

const sha256 = (valor: string) => createHash('sha256').update(valor, 'utf8').digest('hex');

export const contractDataSchema = z.object({
  fullName: z.string().trim().min(3).max(160),
  documentNumber: z.string().trim().min(11).max(20),
  rg: z.string().trim().min(3).max(40),
  rgIssuer: z.string().trim().min(2).max(40),
  nationality: z.string().trim().min(3).max(60).default('brasileira'),
  profession: z.string().trim().min(2).max(80),
  maritalStatus: z.string().trim().max(60).optional(),
  addressLine: z.string().trim().min(5).max(240),
  addressCity: z.string().trim().min(2).max(120),
  addressState: z.string().trim().length(2).transform((v) => v.toUpperCase()),
  addressZip: z.string().trim().min(8).max(12),
  phone: z.string().trim().max(32).optional()
});

export const signContractSchema = z.object({
  /** Confirmação digitada: o signatário reescreve o próprio nome. */
  signerName: z.string().trim().min(3).max(160),
  signerCpf: z.string().trim().min(11).max(20),
  accepted: z.literal(true)
});

type ContractSource = {
  reservation_id: string;
  check_in: string;
  check_out: string;
  guest_count: number;
  total_amount: string;
  deposit_amount: string;
  deposit_percentage: string;
  status: string;
  property_kind: string;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  legal_forum: string | null;
  cancellation_policy: string | null;
  max_guests: number;
  check_in_time: string;
  check_out_time: string;
  customer_id: string;
  customer_name: string;
  customer_document: string | null;
  customer_rg: string | null;
  customer_rg_issuer: string | null;
  customer_nationality: string | null;
  customer_profession: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_state: string | null;
  customer_zip: string | null;
  landlord_name: string | null;
  landlord_nationality: string | null;
  landlord_marital: string | null;
  landlord_profession: string | null;
  landlord_rg: string | null;
  landlord_rg_issuer: string | null;
  landlord_cpf: string | null;
  landlord_address: string | null;
  landlord_city: string | null;
  landlord_state: string | null;
  landlord_zip: string | null;
};

async function loadSource(reservationId: string, customerId?: string): Promise<ContractSource> {
  const result = await query<ContractSource>(
    `SELECT r.id AS reservation_id, r.check_in::text AS check_in, r.check_out::text AS check_out,
            r.guest_count, r.total_amount, r.deposit_amount, r.status,
            p.deposit_percentage, p.property_kind, p.max_guests,
            p.address_line AS property_address, p.address_city AS property_city,
            p.address_state AS property_state, p.address_zip AS property_zip,
            p.legal_forum, p.cancellation_policy,
            p.check_in_time::text AS check_in_time, p.check_out_time::text AS check_out_time,
            u.id AS customer_id, u.full_name AS customer_name,
            u.document_number AS customer_document, u.rg AS customer_rg,
            u.rg_issuer AS customer_rg_issuer, u.nationality AS customer_nationality,
            u.profession AS customer_profession, u.address_line AS customer_address,
            u.address_city AS customer_city, u.address_state AS customer_state,
            u.address_zip AS customer_zip,
            l.full_name AS landlord_name, l.nationality AS landlord_nationality,
            l.marital_status AS landlord_marital, l.profession AS landlord_profession,
            l.rg AS landlord_rg, l.rg_issuer AS landlord_rg_issuer, l.cpf AS landlord_cpf,
            l.address_line AS landlord_address, l.city AS landlord_city,
            l.state AS landlord_state, l.zip AS landlord_zip
     FROM reservations r
     JOIN properties p ON p.id = r.property_id
     JOIN users u ON u.id = r.customer_id
     LEFT JOIN landlords l ON l.id = p.landlord_id
     WHERE r.id = $1 ${customerId ? 'AND r.customer_id = $2' : ''}`,
    customerId ? [reservationId, customerId] : [reservationId]
  );
  const source = result.rows[0];
  if (!source) throw notFound('RESERVATION_NOT_FOUND');
  return source;
}

/** Condições de pagamento derivadas da reserva, não escritas à mão. */
function condicoesPagamento(totalCents: number, depositCents: number, checkIn: string): string {
  const balanceCents = totalCents - depositCents;
  const percentual = Math.round((depositCents / totalCents) * 100);

  if (balanceCents <= 0) {
    return `O pagamento será realizado em parcela única no valor de ${moedaBRL(totalCents)} (${valorPorExtenso(totalCents)}), via Pix ou cartão, mediante link de pagamento enviado pela LOCADORA.`;
  }

  return (
    `O pagamento será realizado via Pix ou cartão, mediante link de pagamento enviado pela LOCADORA, ` +
    `dividido nas seguintes condições: ` +
    `a) ENTRADA DE ${percentual}%: no valor de ${moedaBRL(depositCents)} (${valorPorExtenso(depositCents)}), ` +
    `cujo link de pagamento é disponibilizado nesta data, sendo a reserva confirmada somente após a aprovação deste pagamento; ` +
    `b) SALDO REMANESCENTE: no valor de ${moedaBRL(balanceCents)} (${valorPorExtenso(balanceCents)}), ` +
    `a ser pago até o dia ${dataPorExtenso(checkIn)}, data do check-in.`
  );
}

/** Campos de qualificação que faltam para o contrato poder ser emitido. */
export function missingCustomerData(source: ContractSource): string[] {
  const faltando: string[] = [];
  if (!source.customer_document) faltando.push('documentNumber');
  if (!source.customer_rg) faltando.push('rg');
  if (!source.customer_rg_issuer) faltando.push('rgIssuer');
  if (!source.customer_profession) faltando.push('profession');
  if (!source.customer_address) faltando.push('addressLine');
  if (!source.customer_city) faltando.push('addressCity');
  if (!source.customer_state) faltando.push('addressState');
  if (!source.customer_zip) faltando.push('addressZip');
  return faltando;
}

function buildVariables(source: ContractSource): Record<string, string> {
  const totalCents = Math.round(Number(source.total_amount) * 100);
  const depositCents = Math.round(Number(source.deposit_amount) * 100);

  return {
    locadora_nome: source.landlord_name ?? '',
    locadora_nacionalidade: source.landlord_nationality ?? 'brasileira',
    locadora_estado_civil: source.landlord_marital ?? '',
    locadora_profissao: source.landlord_profession ?? '',
    locadora_rg: source.landlord_rg ?? '',
    locadora_rg_orgao: source.landlord_rg_issuer ?? '',
    locadora_cpf: source.landlord_cpf ?? '',
    locadora_endereco: source.landlord_address ?? '',
    locadora_cidade: source.landlord_city ?? '',
    locadora_uf: source.landlord_state ?? '',
    locadora_cep: source.landlord_zip ?? '',

    locataria_nome: source.customer_name,
    locataria_nacionalidade: source.customer_nationality ?? 'brasileira',
    locataria_profissao: source.customer_profession ?? '',
    locataria_rg: source.customer_rg ?? '',
    locataria_rg_orgao: source.customer_rg_issuer ?? '',
    locataria_cpf: source.customer_document ?? '',
    locataria_endereco: source.customer_address ?? '',
    locataria_cidade: source.customer_city ?? '',
    locataria_uf: source.customer_state ?? '',
    locataria_cep: source.customer_zip ?? '',

    imovel_tipo: source.property_kind,
    imovel_endereco: source.property_address ?? '',
    imovel_cidade: source.property_city ?? '',
    imovel_uf: source.property_state ?? '',
    imovel_cep: source.property_zip ?? '',

    checkin_extenso: dataPorExtenso(source.check_in),
    checkout_extenso: dataPorExtenso(source.check_out),
    checkin_hora: source.check_in_time.slice(0, 5),
    checkout_hora: source.check_out_time.slice(0, 5),

    valor_total: moedaBRL(totalCents),
    valor_total_extenso: valorPorExtenso(totalCents),
    condicoes_pagamento: condicoesPagamento(totalCents, depositCents, source.check_in),

    capacidade: String(source.max_guests).padStart(2, '0'),
    capacidade_extenso: numeroPorExtenso(source.max_guests),

    politica_cancelamento: source.cancellation_policy ?? '',
    foro: source.legal_forum ?? '',

    cidade_assinatura: source.landlord_city ?? '',
    data_assinatura: dataPorExtenso(new Date().toISOString().slice(0, 10))
  };
}

/**
 * Emite (ou devolve) o contrato da reserva. Idempotente: enquanto não estiver
 * assinado, reemitir atualiza o texto; depois de assinado, o texto é imutável.
 */
export async function issueContract(reservationId: string, customerId?: string) {
  const source = await loadSource(reservationId, customerId);

  const existing = await query(
    `SELECT id, status, body, body_hash, template_version, signer_name, signed_at,
            signature_hash, variables
     FROM contracts WHERE reservation_id = $1 AND status <> 'CANCELLED'`,
    [reservationId]
  );
  if (existing.rows[0]?.status === 'SIGNED') return existing.rows[0];

  if (source.status === 'CANCELLED' || source.status === 'EXPIRED') {
    throw conflict('RESERVATION_NOT_CONTRACTABLE');
  }

  const faltando = missingCustomerData(source);
  if (faltando.length) throw new AppError(422, 'CUSTOMER_DATA_INCOMPLETE', { missing: faltando });

  if (!source.property_address || !source.legal_forum) {
    // O imóvel precisa estar identificado por endereço; sem isso a Cláusula
    // Primeira sai incompleta e o instrumento perde serventia.
    throw new AppError(409, 'PROPERTY_ADDRESS_MISSING', {
      property: source.property_city ?? 'desconhecida'
    });
  }

  const template = await query<{ id: string; version: string; body: string }>(
    `SELECT id, version, body FROM contract_templates WHERE active = true LIMIT 1`
  );
  if (!template.rows[0]) throw conflict('CONTRACT_TEMPLATE_MISSING');

  const variables = buildVariables(source);
  let body: string;
  try {
    body = preencherModelo(template.rows[0].body, variables);
  } catch (error) {
    throw new AppError(422, 'CONTRACT_VARIABLES_MISSING', {
      missing: (error as { missing?: string[] }).missing ?? []
    });
  }

  const bodyHash = sha256(body);

  const saved = await query(
    `INSERT INTO contracts (reservation_id, template_id, template_version, status,
                            body, variables, body_hash)
     VALUES ($1, $2, $3, 'AWAITING_SIGNATURE', $4, $5::jsonb, $6)
     ON CONFLICT (reservation_id) WHERE status <> 'CANCELLED'
     DO UPDATE SET body = EXCLUDED.body, variables = EXCLUDED.variables,
                   body_hash = EXCLUDED.body_hash, template_id = EXCLUDED.template_id,
                   template_version = EXCLUDED.template_version, updated_at = now()
     RETURNING id, status, body, body_hash, template_version, signer_name, signed_at,
               signature_hash, variables`,
    [reservationId, template.rows[0].id, template.rows[0].version, body, JSON.stringify(variables), bodyHash]
  );
  return saved.rows[0];
}

export async function getContract(reservationId: string, customerId?: string) {
  const result = await query(
    `SELECT c.id, c.status, c.body, c.body_hash, c.template_version, c.signer_name,
            c.signer_cpf, c.signed_at, c.signature_hash, c.created_at
     FROM contracts c JOIN reservations r ON r.id = c.reservation_id
     WHERE c.reservation_id = $1 AND c.status <> 'CANCELLED'
       ${customerId ? 'AND r.customer_id = $2' : ''}`,
    customerId ? [reservationId, customerId] : [reservationId]
  );
  const contract = result.rows[0];
  if (!contract) throw notFound('CONTRACT_NOT_FOUND');
  return contract;
}

/**
 * Registra o aceite. O hash amarra texto, signatário e instante: se qualquer
 * um mudar depois, a conferência não fecha.
 */
export async function signContract(
  reservationId: string,
  customerId: string,
  input: z.infer<typeof signContractSchema>,
  context: { ip?: string | null; userAgent?: string | null }
) {
  return transaction(async (client) => {
    const found = await client.query<{
      id: string;
      status: string;
      body_hash: string;
      customer_name: string;
      customer_document: string | null;
    }>(
      `SELECT c.id, c.status, c.body_hash, u.full_name AS customer_name,
              u.document_number AS customer_document
       FROM contracts c
       JOIN reservations r ON r.id = c.reservation_id
       JOIN users u ON u.id = r.customer_id
       WHERE c.reservation_id = $1 AND r.customer_id = $2 AND c.status <> 'CANCELLED'
       FOR UPDATE OF c`,
      [reservationId, customerId]
    );
    const contract = found.rows[0];
    if (!contract) throw notFound('CONTRACT_NOT_FOUND');
    if (contract.status === 'SIGNED') return { alreadySigned: true, contractId: contract.id };

    // Conferência de identidade: o nome e o CPF digitados têm que ser os do
    // cadastro. Sem isso, "assinar" seria só marcar uma caixa.
    const normalize = (valor: string) =>
      valor
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    const onlyDigits = (valor: string) => valor.replace(/\D/g, '');

    if (normalize(input.signerName) !== normalize(contract.customer_name)) {
      throw badRequest('SIGNER_NAME_MISMATCH');
    }
    if (
      !contract.customer_document ||
      onlyDigits(input.signerCpf) !== onlyDigits(contract.customer_document)
    ) {
      throw badRequest('SIGNER_CPF_MISMATCH');
    }

    const signedAt = new Date();
    const signatureHash = sha256(
      [contract.body_hash, normalize(input.signerName), onlyDigits(input.signerCpf), signedAt.toISOString()].join('|')
    );

    await client.query(
      `UPDATE contracts
       SET status = 'SIGNED', signer_name = $2, signer_cpf = $3, signer_ip = $4,
           signer_user_agent = $5, signed_at = $6, signature_hash = $7, updated_at = now()
       WHERE id = $1`,
      [
        contract.id,
        input.signerName.trim(),
        input.signerCpf.trim(),
        context.ip ?? null,
        context.userAgent?.slice(0, 400) ?? null,
        signedAt,
        signatureHash
      ]
    );

    await client.query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'CONTRACT', $2, 'SIGNED', $3)`,
      [
        customerId,
        contract.id,
        JSON.stringify({
          reservationId,
          bodyHash: contract.body_hash,
          signatureHash,
          ip: context.ip ?? null
        })
      ]
    );

    await syncLeadFromReservation(reservationId, client);

    return { alreadySigned: false, contractId: contract.id, signatureHash, signedAt };
  });
}

/** Atualiza a qualificação do locatário antes da emissão. */
export async function saveCustomerContractData(
  customerId: string,
  input: z.infer<typeof contractDataSchema>
) {
  const result = await query(
    `UPDATE users SET
       full_name = $2, document_number = $3, rg = $4, rg_issuer = $5,
       nationality = $6, profession = $7, marital_status = $8,
       address_line = $9, address_city = $10, address_state = $11, address_zip = $12,
       phone = COALESCE($13, phone), updated_at = now()
     WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
     RETURNING id, full_name, document_number, rg, rg_issuer, nationality, profession,
               marital_status, address_line, address_city, address_state, address_zip, phone`,
    [
      customerId,
      input.fullName,
      input.documentNumber,
      input.rg,
      input.rgIssuer,
      input.nationality,
      input.profession,
      input.maritalStatus ?? null,
      input.addressLine,
      input.addressCity,
      input.addressState,
      input.addressZip,
      input.phone ?? null
    ]
  );
  if (!result.rowCount) throw notFound('USER_NOT_FOUND');
  return result.rows[0];
}

/** Estado do fluxo, para a página saber qual passo mostrar. */
export async function contractStatusFor(reservationId: string, customerId: string) {
  const source = await loadSource(reservationId, customerId);
  const missing = missingCustomerData(source);
  const contract = await query<{ status: string; signed_at: string | null }>(
    `SELECT status, signed_at FROM contracts
     WHERE reservation_id = $1 AND status <> 'CANCELLED'`,
    [reservationId]
  );

  return {
    missingCustomerData: missing,
    propertyReady: Boolean(source.property_address && source.legal_forum),
    contractStatus: contract.rows[0]?.status ?? null,
    signedAt: contract.rows[0]?.signed_at ?? null
  };
}
