import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { passwordResetSchema, resetUserPassword } from '@/server/adminUsers';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ userId: z.string().uuid() });

/**
 * Redefinição de senha pelo administrador — o caso "o cliente esqueceu".
 * Derruba as sessões do alvo: se a troca foi por suspeita, manter a sessão
 * viva anularia o motivo.
 */
export async function POST(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { userId } = params.parse(await ctx.params);
    const input = await parseBody(request, passwordResetSchema);
    return json(await resetUserPassword(userId, session.id, input));
  });
}
