import { requireAdmin } from '@/server/auth';
import { dashboard, dashboardSchema } from '@/server/adminDashboard';
import { handle, json, parseQuery } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    return json(await dashboard(parseQuery(request, dashboardSchema)));
  });
}
