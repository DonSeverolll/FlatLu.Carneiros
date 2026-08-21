import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { confirmPaymentSchema, settlePayment } from '@/server/payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Conciliação manual do Pix: o administrador confere o extrato e confirma.
 * Mesma trilha de auditoria e mesmas transições de estado do webhook.
 */
export async function POST(request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { reservationId } = z.object({ reservationId: z.string().uuid() }).parse(await ctx.params);
    const input = await parseBody(request, confirmPaymentSchema);
    const result = await settlePayment({
      reservationId,
      provider: 'MANUAL_PIX',
      transactionId: null,
      status: input.status,
      amount: input.amount,
      actorUserId: session.id,
      metadata: { source: 'ADMIN_CONFIRMATION', note: input.note ?? null }
    });
    return json(result);
  });
}
