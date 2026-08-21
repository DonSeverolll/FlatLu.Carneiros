import { secretMatches } from '@/server/auth';
import { config } from '@/server/config';
import { handle, json, parseBody } from '@/server/http';
import { unauthorized } from '@/server/errors';
import {
  claimWebhookEvent,
  markWebhookProcessed,
  settlePayment,
  webhookSchema
} from '@/server/payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de provedor. Não passa por `assertSameOrigin` (chamada servidor a
 * servidor, sem Origin); a autenticação é o segredo compartilhado, comparado
 * em tempo constante.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const presented = request.headers.get('x-payment-webhook-secret');
    if (!presented || !secretMatches(config.paymentWebhookSecret, presented)) {
      throw unauthorized('INVALID_WEBHOOK_SIGNATURE');
    }

    const input = await parseBody(request, webhookSchema);

    const eventId = await claimWebhookEvent(input.provider, input.eventId, input);
    if (!eventId) return json({ received: true, duplicate: true });

    const result = await settlePayment({
      reservationId: input.reservationId,
      provider: input.provider,
      transactionId: input.transactionId,
      status: input.status,
      amount: input.amount,
      metadata: { source: 'WEBHOOK', eventId: input.eventId }
    });
    await markWebhookProcessed(eventId);
    return json({ received: true, ...result });
  });
}
