import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody, parseQuery } from '@/server/http';
import { iniciarConversa, iniciarSchema, listarConversas, listarSchema } from '@/server/atendimento/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    return json(await listarConversas(parseQuery(request, listarSchema)));
  });
}

/** Abre (ou reabre) conversa de WhatsApp com um lead do CRM. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { leadId } = await parseBody(request, iniciarSchema);
    return json(await iniciarConversa(leadId), 201);
  });
}
