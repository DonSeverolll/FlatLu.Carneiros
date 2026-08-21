import { z } from 'zod';
import QRCode from 'qrcode';
import { requireUser } from '@/server/auth';
import { handle } from '@/server/http';
import { createPaymentIntent } from '@/server/payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * QR do Pix renderizado no servidor. Mantém o gerador fora do bundle do
 * navegador e garante que o QR e o copia-e-cola vêm sempre do mesmo payload.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    const session = await requireUser();
    const { reservationId } = z.object({ reservationId: z.string().uuid() }).parse(await ctx.params);
    const intent = await createPaymentIntent(reservationId, session.id);
    const svg = await QRCode.toString(intent.pix.payload, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M'
    });
    return new Response(svg, {
      headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' }
    });
  });
}
