import { requireFerramenta } from '@/server/acesso';
import { recordAudit } from '@/server/audit';
import { assertSameOrigin, handle, json } from '@/server/http';
import { aceitarSugestoes } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireFerramenta('catalogo');
    const r = await aceitarSugestoes();
    await recordAudit({ actorUserId: session.id, entityType: 'INTEGRACAO', eventType: 'CATALOGO_SUGESTOES_ACEITAS', metadata: r });
    return json(r);
  });
}
