import { AppError } from './errors';

/**
 * Provedor de pagamento por cartão.
 *
 * O Pix é atendido internamente (BR Code estático, sem intermediário). Cartão
 * exige adquirente, e a escolha é Mercado Pago. Tudo está montado: falta só a
 * credencial em `MERCADOPAGO_ACCESS_TOKEN`.
 *
 * Enquanto ela não existir, `createCardCheckout` recusa com um erro explícito
 * em vez de simular sucesso — cobrança que finge ter dado certo é pior que
 * cobrança indisponível.
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
        email: input.payer.email
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
      notification_url: input.notificationUrl
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
