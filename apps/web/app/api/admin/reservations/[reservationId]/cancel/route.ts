import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { cancelReservation, cancelSchema } from '@/server/admin';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { reservationId } = z.object({ reservationId: z.string().uuid() }).parse(await ctx.params);
    const input = await parseBody(request, cancelSchema);
    return json({ reservation: await cancelReservation(reservationId, session.id, input) });
  });
}
