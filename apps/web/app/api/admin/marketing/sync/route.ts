import { z } from 'zod';
import { recordAudit } from '@/server/audit';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { importarConversasInstagram, sincronizarAnuncios } from '@/server/meta/ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Paginação da Graph API pode passar dos 10 s padrão.
export const maxDuration = 60;

const schema = z.object({
  escopo: z.enum(['anuncios', 'instagram']),
  dias: z.number().int().min(1).max(90).default(30)
});

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const input = await parseBody(request, schema);
    const resultado =
      input.escopo === 'anuncios'
        ? await sincronizarAnuncios(input.dias)
        : await importarConversasInstagram();
    await recordAudit({
      actorUserId: session.id,
      entityType: 'SESSION',
      eventType: input.escopo === 'anuncios' ? 'META_ADS_SYNC' : 'INSTAGRAM_IMPORT',
      metadata: resultado
    });
    return json(resultado);
  });
}
