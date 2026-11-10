import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import {
  atualizarConversa,
  atualizarSchema,
  detalheConversa,
  mudancasConversa,
  mudancasSchema
} from '@/server/atendimento/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ conversaId: z.string().uuid() });
type Ctx = { params: Promise<{ conversaId: string }> };

/**
 * Sem `?desde=`: conversa completa (últimas mensagens + lead + reserva).
 * Com `?desde=<cursor>`: só o que mudou — mensagem nova ou status novo — para
 * o polling da tela não baixar o histórico inteiro a cada poucos segundos.
 */
export async function GET(request: Request, ctx: Ctx) {
  return handle(async () => {
    await requireAdmin();
    const { conversaId } = params.parse(await ctx.params);
    const desde = new URL(request.url).searchParams.get('desde');
    if (desde) {
      const { desde: cursor } = mudancasSchema.parse({ desde });
      return json(await mudancasConversa(conversaId, cursor));
    }
    return json(await detalheConversa(conversaId));
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { conversaId } = params.parse(await ctx.params);
    const input = await parseBody(request, atualizarSchema);
    return json({ conversa: await atualizarConversa(conversaId, input) });
  });
}
