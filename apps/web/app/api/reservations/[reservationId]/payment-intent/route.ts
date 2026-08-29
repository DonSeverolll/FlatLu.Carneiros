import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { createPaymentIntent, paymentIntentSchema } from '@/server/payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Gera a cobrança do sinal (Pix copia-e-cola com valor e identificador fixos).
 * É o passo que não existia: antes a reserva nascia PENDING_PAYMENT e morria
 * sem que houvesse qualquer forma de pagar.
 */
export async function POST(request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireUser();
    const { reservationId } = z.object({ reservationId: z.string().uuid() }).parse(await ctx.params);
    const input = await parseBody(request, paymentIntentSchema).catch(() =>
      paymentIntentSchema.parse({})
    );
    // A origem alimenta as URLs de retorno do provedor de cartão.
    const origin = request.headers.get('origin') ?? '';
    return json(await createPaymentIntent(reservationId, session.id, input, origin), 201);
  });
}
