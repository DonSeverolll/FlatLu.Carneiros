import { requireUser } from '@/server/auth';
import { handle, json } from '@/server/http';
import { currentUser } from '@/server/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const session = await requireUser();
    return json({ user: await currentUser(session.id) });
  });
}
