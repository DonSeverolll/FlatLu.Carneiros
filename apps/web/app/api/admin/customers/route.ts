import { requireAdmin } from '@/server/auth';
import { customerListSchema, listCustomers } from '@/server/adminCustomers';
import { handle, json, parseQuery } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    return json(await listCustomers(parseQuery(request, customerListSchema)));
  });
}
