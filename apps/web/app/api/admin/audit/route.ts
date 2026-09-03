import { requireAdmin } from '@/server/auth';
import { auditListSchema, listAuditEvents } from '@/server/adminAudit';
import { handle, json, parseQuery } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Log de eventos: tudo que o sistema registrou, do mais recente ao mais antigo. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    return json(await listAuditEvents(parseQuery(request, auditListSchema)));
  });
}
