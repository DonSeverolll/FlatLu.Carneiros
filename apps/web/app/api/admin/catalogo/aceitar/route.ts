import { recordAudit } from '@/server/audit';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';
import { aceitarSugestoes } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const r = await aceitarSugestoes();
    await recordAudit({ actorUserId: session.id, entityType: 'INTEGRACAO', eventType: 'CATALOGO_SUGESTOES_ACEITAS', metadata: r });
    return json(r);
  });
}
