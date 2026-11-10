import { recordAudit } from '@/server/audit';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';
import { sincronizarCatalogo } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Puxa os posts do Instagram conectado e renova as URLs das fotos. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const resultado = await sincronizarCatalogo();
    await recordAudit({ actorUserId: session.id, entityType: 'INTEGRACAO', eventType: 'CATALOGO_SINCRONIZADO', metadata: resultado });
    return json(resultado);
  });
}
