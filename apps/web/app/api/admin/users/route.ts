import { requireAdmin } from '@/server/auth';
import { listUsers, userListSchema } from '@/server/adminUsers';
import { handle, json, parseQuery } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    return json({ users: await listUsers(parseQuery(request, userListSchema)) });
  });
}
