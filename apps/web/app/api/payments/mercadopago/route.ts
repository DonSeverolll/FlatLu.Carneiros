import { CARD_PROVIDER, verifyWebhookSignature } from '@/server/paymentProvider';
import { claimWebhookEvent, markWebhookProcessed, settleFromProvider } from '@/server/payment';
import { handle, json } from '@/server/http';
import { unauthorized } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Notificações do Mercado Pago.
 *
 * Rota separada da genérica `/api/payments/webhook` porque o formato não tem
 * nada a ver: lá o corpo traz o estado pronto e um segredo compartilhado no
 * cabeçalho; aqui chega só "o pagamento X mudou", e é preciso perguntar à API
 * dele o que de fato aconteceu.
 *
 * Essa consulta é a defesa que vale. A assinatura é conferida quando
 * `MERCADOPAGO_WEBHOOK_SECRET` está configurado, mas mesmo sem ela ninguém
 * consegue declarar um pagamento como aprovado: o estado sempre vem do
 * provedor, nunca do corpo da requisição.
 *
 * Responde 200 em quase tudo de propósito — o Mercado Pago reenvia o que
 * falha, e uma notificação de um pagamento que não é nosso ficaria em
 * reenvio eterno se devolvesse erro.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const corpo = (await request.json().catch(() => ({}))) as {
      type?: string;
      topic?: string;
      action?: string;
      data?: { id?: string | number };
    };

    // O id vem no corpo ou na query, conforme a versão da notificação.
    const dataId =
      (corpo.data?.id !== undefined ? String(corpo.data.id) : null) ??
      url.searchParams.get('data.id') ??
      url.searchParams.get('id');

    const tipo = corpo.type ?? corpo.topic ?? url.searchParams.get('type') ?? '';

    const assinatura = verifyWebhookSignature({
      signatureHeader: request.headers.get('x-signature'),
      requestId: request.headers.get('x-request-id'),
      dataId
    });
    if (assinatura === false) throw unauthorized('INVALID_WEBHOOK_SIGNATURE');

    // Só pagamento interessa. `merchant_order` e afins chegam junto e são ruído.
    if (tipo && tipo !== 'payment') return json({ received: true, ignored: tipo });
    if (!dataId) return json({ received: true, ignored: 'sem data.id' });

    /**
     * O mesmo pagamento gera várias notificações (created, updated...). O id do
     * evento junta o pagamento e a ação para que reenvios sejam descartados sem
     * deixar de processar uma mudança real de estado.
     */
    const eventId = `${dataId}:${corpo.action ?? 'payment'}`;
    const claimado = await claimWebhookEvent(CARD_PROVIDER, eventId, {
      ...corpo,
      signatureChecked: assinatura === true
    });
    if (!claimado) return json({ received: true, duplicate: true });

    const resultado = await settleFromProvider(dataId);
    await markWebhookProcessed(claimado);

    return json({ received: true, ...resultado });
  });
}

/** O Mercado Pago faz um GET de verificação ao cadastrar a URL. */
export async function GET() {
  return json({ ok: true, provider: CARD_PROVIDER });
}
