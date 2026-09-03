import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { releaseBlock, releaseSchema } from '@/server/adminBlocks';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Libera as noites de um bloqueio manual.
 *
 * DELETE com corpo é incomum, mas o motivo da liberação é obrigatório: sem ele
 * o log registraria que alguém devolveu datas à venda sem dizer por quê.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ blockId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { blockId } = z.object({ blockId: z.string().uuid() }).parse(await ctx.params);
    const input = await parseBody(request, releaseSchema);
    return json({ released: await releaseBlock(blockId, session.id, input.reason) });
  });
}
