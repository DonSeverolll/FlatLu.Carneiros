import { requireUser } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { requestContext } from '@/server/request';
import { createReservation, createReservationSchema } from '@/server/reservation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireUser();
    const input = await parseBody(request, createReservationSchema);
    const { reservation, created } = await createReservation(input, session, requestContext(request));
    return json({ reservation }, created ? 201 : 200);
  });
}
