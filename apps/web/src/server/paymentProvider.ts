import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';

/**
 * Mercado Pago: cartão e Pix.
 *
 * Com a credencial configurada o Pix passa a ser DINÂMICO — o QR nasce na API
 * do provedor, tem valor e vencimento próprios e avisa por webhook quando é
 * pago. É o que torna a baixa automática: o BR Code estático gerado aqui
 * dentro não tem como ser conciliado, porque o banco não avisa ninguém.
 *
 * Sem a credencial tudo continua funcionando no modo manual, com Pix estático
 * e confirmação pelo painel. Nada finge ter dado certo.
 */

export type CardCheckoutInput = {
  reference: string;
  description: string;
  amountCents: number;
  installments: number;
  payer: { name: string; email: string; document?: string | null };
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  notificationUrl: string;
};

export type CardCheckout = {
  provider: string;
  checkoutUrl: string;
  providerReference: string;
};

export function cardProviderConfigured(): boolean {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
}

/** Domínios que existem só dentro da rede e que o provedor recusa. */
const TLD_INTERNO = /\.(local|localhost|test|invalid|internal|example)$/i;

/**
 * E-mail aceitável para o provedor.
 *
 * As contas de administrador usam `@flatcarneiros.local`, e o Mercado Pago
 * recusa com "payer.email must be a valid email" — o que derrubaria a cobrança
 * inteira por causa de um campo que, no Pix, é apenas informativo. Nesses
 * casos entra um endereço neutro; o hóspede de verdade nunca cai aqui.
 */
function payerEmail(email: string): string {
  const limpo = email.trim().toLowerCase();
  const dominio = limpo.split('@')[1] ?? '';
  if (!dominio || TLD_INTERNO.test(dominio)) return 'reservas@aptcarneiros.com.br';
  return limpo;
}

/**
 * URL de notificação que o provedor aceita.
 *
 * Ele exige https público e recusa a cobrança inteira quando recebe outra
 * coisa — `localhost` em desenvolvimento, ou caminho relativo quando a
 * requisição chegou sem origem. Nesses casos o campo é omitido: a cobrança
 * sai normalmente, só não avisa ninguém, que é o comportamento correto fora
 * de produção.
 */
function notificationUrlOrNull(url: string): string | null {
  try {
    const alvo = new URL(url);
    if (alvo.protocol !== 'https:') return null;
    if (alvo.hostname === 'localhost' || alvo.hostname === '127.0.0.1') return null;
    // Sem ponto no host não há DNS público que resolva.
    if (!alvo.hostname.includes('.')) return null;
    return alvo.toString();
  } catch {
    return null;
  }
}

/** Nome do provedor gravado em `payments.provider`. */
export const CARD_PROVIDER = 'MERCADOPAGO';

export async function createCardCheckout(input: CardCheckoutInput): Promise<CardCheckout> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new AppError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', { provider: CARD_PROVIDER });
  }

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Repetir a chamada com a mesma referência não pode gerar duas cobranças.
      'X-Idempotency-Key': input.reference
    },
    body: JSON.stringify({
      external_reference: input.reference,
      items: [
        {
          title: input.description,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: Number((input.amountCents / 100).toFixed(2))
        }
      ],
      payer: {
        name: input.payer.name,
        email: payerEmail(input.payer.email)
      },
      payment_methods: {
        // Boleto fica de fora: compensação lenta demais para segurar uma data.
        excluded_payment_types: [{ id: 'ticket' }],
        installments: input.installments
      },
      back_urls: {
        success: input.successUrl,
        failure: input.failureUrl,
        pending: input.pendingUrl
      },
      auto_return: 'approved',
      ...(notificationUrlOrNull(input.notificationUrl)
        ? { notification_url: notificationUrlOrNull(input.notificationUrl) }
        : {})
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[mercadopago] preferência recusada', response.status, detail.slice(0, 400));
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', { status: response.status });
  }

  const preference = (await response.json()) as {
    id: string;
    init_point?: string;
    sandbox_init_point?: string;
  };
  const checkoutUrl = preference.init_point ?? preference.sandbox_init_point;
  if (!checkoutUrl) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', { reason: 'sem init_point' });

  return { provider: CARD_PROVIDER, checkoutUrl, providerReference: preference.id };
}

/**
 * Traduz o status do Mercado Pago para o nosso.
 *
 * `in_process` e `pending` são coisas diferentes lá: o primeiro é análise em
 * andamento, o segundo é aguardando o pagador. Aqui viram PROCESSING e
 * PENDING, que é o que o hóspede vê.
 */
export function translateProviderStatus(
  status: string
): 'PENDING' | 'PROCESSING' | 'PAID' | 'DECLINED' | 'REFUNDED' | 'CANCELLED' {
  switch (status) {
    case 'approved':
      return 'PAID';
    case 'in_process':
    case 'authorized':
      return 'PROCESSING';
    case 'rejected':
      return 'DECLINED';
    case 'refunded':
    case 'charged_back':
      return 'REFUNDED';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

// ---------------------------------------------------------------------------
// Pix dinâmico
// ---------------------------------------------------------------------------

export type PixChargeInput = {
  reference: string;
  description: string;
  amountCents: number;
  payer: { name: string; email: string; document?: string | null };
  notificationUrl: string;
  /** Minutos até o QR expirar. */
  expiresInMinutes: number;
};

export type PixCharge = {
  provider: string;
  providerPaymentId: string;
  /** Copia e cola. */
  payload: string;
  /** PNG em base64, sem o prefixo `data:`. */
  qrCodeBase64: string | null;
  expiresAt: string | null;
  status: string;
};

/** O Pix só vira automático quando há credencial; senão, cai no modo manual. */
export function pixProviderConfigured(): boolean {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
}

function accessToken(): string {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new AppError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', { provider: CARD_PROVIDER });
  }
  return token;
}

/**
 * Nome e sobrenome separados, como a API exige.
 *
 * Quem se cadastrou só com o primeiro nome não pode travar a cobrança, então o
 * sobrenome cai para um ponto — o provedor aceita e o Pix sai.
 */
function splitName(fullName: string): { first: string; last: string } {
  const partes = fullName.trim().split(/\s+/);
  return { first: partes[0] ?? 'Hospede', last: partes.slice(1).join(' ') || '.' };
}

export async function createPixCharge(input: PixChargeInput): Promise<PixCharge> {
  const token = accessToken();
  const { first, last } = splitName(input.payer.name);
  const documento = (input.payer.document ?? '').replace(/\D/g, '');
  const vencimento = new Date(Date.now() + input.expiresInMinutes * 60_000);
  const notificacao = notificationUrlOrNull(input.notificationUrl);

  const response = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // A mesma referência não pode gerar duas cobranças.
      'X-Idempotency-Key': `pix-${input.reference}`
    },
    body: JSON.stringify({
      transaction_amount: Number((input.amountCents / 100).toFixed(2)),
      description: input.description,
      payment_method_id: 'pix',
      external_reference: input.reference,
      ...(notificacao ? { notification_url: notificacao } : {}),
      date_of_expiration: vencimento.toISOString().replace('Z', '-00:00'),
      payer: {
        email: payerEmail(input.payer.email),
        first_name: first,
        last_name: last,
        ...(documento.length === 11 || documento.length === 14
          ? {
              identification: {
                type: documento.length === 11 ? 'CPF' : 'CNPJ',
                number: documento
              }
            }
          : {})
      }
    })
  });

  if (!response.ok) {
    const detalhe = await response.text().catch(() => '');
    console.error('[mercadopago] Pix recusado', response.status, detalhe.slice(0, 400));
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', { status: response.status });
  }

  const pagamento = (await response.json()) as {
    id: number;
    status: string;
    date_of_expiration?: string;
    point_of_interaction?: {
      transaction_data?: { qr_code?: string; qr_code_base64?: string };
    };
  };

  const dados = pagamento.point_of_interaction?.transaction_data;
  if (!dados?.qr_code) {
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', { reason: 'sem qr_code' });
  }

  return {
    provider: CARD_PROVIDER,
    providerPaymentId: String(pagamento.id),
    payload: dados.qr_code,
    qrCodeBase64: dados.qr_code_base64 ?? null,
    expiresAt: pagamento.date_of_expiration ?? vencimento.toISOString(),
    status: pagamento.status
  };
}

// ---------------------------------------------------------------------------
// Consulta de status
// ---------------------------------------------------------------------------

export type ProviderPayment = {
  id: string;
  status: string;
  statusDetail: string | null;
  amount: number;
  externalReference: string | null;
  paymentMethodId: string | null;
  paymentTypeId: string | null;
  approvedAt: string | null;
};

/**
 * Lê o pagamento na fonte.
 *
 * Toda decisão de dinheiro passa por aqui, inclusive quando chega webhook: a
 * notificação diz apenas QUAL pagamento mudou, nunca em que estado ele ficou.
 * Assim uma notificação forjada não consegue marcar nada como pago.
 */
export async function fetchProviderPayment(paymentId: string): Promise<ProviderPayment | null> {
  const token = accessToken();
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    const detalhe = await response.text().catch(() => '');
    console.error('[mercadopago] consulta falhou', response.status, detalhe.slice(0, 300));
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', { status: response.status });
  }

  const p = (await response.json()) as {
    id: number;
    status: string;
    status_detail?: string;
    transaction_amount: number;
    external_reference?: string;
    payment_method_id?: string;
    payment_type_id?: string;
    date_approved?: string;
  };

  return {
    id: String(p.id),
    status: p.status,
    statusDetail: p.status_detail ?? null,
    amount: p.transaction_amount,
    externalReference: p.external_reference ?? null,
    paymentMethodId: p.payment_method_id ?? null,
    paymentTypeId: p.payment_type_id ?? null,
    approvedAt: p.date_approved ?? null
  };
}

/** Acha o pagamento pela nossa referência, quando só temos ela. */
export async function findProviderPaymentByReference(
  reference: string
): Promise<ProviderPayment | null> {
  const token = accessToken();
  const url = new URL('https://api.mercadopago.com/v1/payments/search');
  url.searchParams.set('external_reference', reference);
  url.searchParams.set('sort', 'date_created');
  url.searchParams.set('criteria', 'desc');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (!response.ok) return null;

  const dados = (await response.json()) as { results?: { id: number }[] };
  const primeiro = dados.results?.[0];
  return primeiro ? fetchProviderPayment(String(primeiro.id)) : null;
}

/** Meio de pagamento do provedor traduzido para a nossa coluna `method`. */
export function translateProviderMethod(payment: ProviderPayment): string {
  if (payment.paymentMethodId === 'pix' || payment.paymentTypeId === 'bank_transfer') return 'PIX';
  if (payment.paymentTypeId === 'debit_card') return 'DEBIT_CARD';
  if (payment.paymentTypeId === 'credit_card') return 'CREDIT_CARD';
  return 'PIX';
}

// ---------------------------------------------------------------------------
// Assinatura do webhook
// ---------------------------------------------------------------------------

/**
 * Confere o `x-signature` do Mercado Pago.
 *
 * O manifesto assinado é `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 *
 * Devolve `null` quando o segredo não está configurado — não é aprovação nem
 * recusa, é "não dá para dizer". Quem chama decide o que fazer, e a consulta
 * na API continua sendo a defesa que realmente vale.
 */
export function verifyWebhookSignature(input: {
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
}): boolean | null {
  const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!segredo) return null;
  if (!input.signatureHeader || !input.dataId) return false;

  const partes = new Map<string, string>();
  for (const item of input.signatureHeader.split(',')) {
    const [chave, valor] = item.split('=', 2);
    if (chave && valor) partes.set(chave.trim(), valor.trim());
  }
  const ts = partes.get('ts');
  const v1 = partes.get('v1');
  if (!ts || !v1) return false;

  // O id entra em minúsculas quando é alfanumérico, conforme a documentação.
  const id = /^[a-zA-Z0-9]+$/.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId;
  const manifesto = `id:${id};request-id:${input.requestId ?? ''};ts:${ts};`;
  const esperado = createHmac('sha256', segredo).update(manifesto).digest('hex');

  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
