import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { handle, json } from '@/server/http';
import { getMyReservation } from '@/server/reservation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    const session = await requireUser();
    const { reservationId } = z.object({ reservationId: z.string().uuid() }).parse(await ctx.params);
    return json({ reservation: await getMyReservation(session.id, reservationId) });
  });
}
