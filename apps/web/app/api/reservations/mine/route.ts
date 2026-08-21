import { requireUser } from '@/server/auth';
import { handle, json } from '@/server/http';
import { listMyReservations } from '@/server/reservation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const session = await requireUser();
    return json({ reservations: await listMyReservations(session.id) });
  });
}
