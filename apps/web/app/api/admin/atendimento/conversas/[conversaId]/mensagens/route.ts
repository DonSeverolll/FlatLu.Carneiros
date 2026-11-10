import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { enviarMensagem, enviarSchema } from '@/server/atendimento/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ conversaId: z.string().uuid() });

/**
 * Envia texto, mídia (URL pública ou id de upload) ou modelo aprovado.
 *
 * Falha do provedor NÃO vira erro HTTP: a mensagem fica gravada como FALHOU,
 * com o motivo, e volta para a tela — o atendente precisa ver no histórico o
 * que não saiu, e não só um aviso que some.
 */
export async function POST(request: Request, ctx: { params: Promise<{ conversaId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { conversaId } = params.parse(await ctx.params);
    const input = await parseBody(request, enviarSchema);
    const resultado = await enviarMensagem(conversaId, session.id, input);
    return json(resultado, resultado.erro ? 200 : 201);
  });
}
