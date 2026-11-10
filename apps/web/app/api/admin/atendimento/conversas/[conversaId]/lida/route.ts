import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle } from '@/server/http';
import { marcarLida } from '@/server/atendimento/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ conversaId: z.string().uuid() });

export async function POST(request: Request, ctx: { params: Promise<{ conversaId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { conversaId } = params.parse(await ctx.params);
    await marcarLida(conversaId);
    return new Response(null, { status: 204 });
  });
}
