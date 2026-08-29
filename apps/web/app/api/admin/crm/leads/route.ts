import { requireAdmin } from '@/server/auth';
import { createLead, leadCreateSchema, leadListSchema, listLeads } from '@/server/crm';
import { assertSameOrigin, handle, json, parseBody, parseQuery } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    return json(await listLeads(parseQuery(request, leadListSchema)));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const input = await parseBody(request, leadCreateSchema);
    return json(await createLead(input, session.id), 201);
  });
}
