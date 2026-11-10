import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { atualizarMidia, atualizarMidiaSchema } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ midiaId: z.string().uuid() });

/** Espaço, visibilidade, capa, ordem e texto alternativo de uma foto. */
export async function PATCH(request: Request, ctx: { params: Promise<{ midiaId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { midiaId } = params.parse(await ctx.params);
    return json(await atualizarMidia(midiaId, await parseBody(request, atualizarMidiaSchema)));
  });
}
