import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { reservationNotesSchema, saveReservationNotes } from '@/server/admin';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ reservationId: z.string().uuid() });

export async function PATCH(request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { reservationId } = params.parse(await ctx.params);
    const input = await parseBody(request, reservationNotesSchema);
    return json({ reservation: await saveReservationNotes(reservationId, session.id, input) });
  });
}
