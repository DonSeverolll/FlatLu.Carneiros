import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';
import { sugerirResposta } from '@/server/agente/agente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const params = z.object({ conversaId: z.string().uuid() });

/** Rascunho do agente de IA para o atendente revisar. Nada é enviado aqui. */
export async function POST(request: Request, ctx: { params: Promise<{ conversaId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { conversaId } = params.parse(await ctx.params);
    return json(await sugerirResposta(conversaId));
  });
}
