import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';
import { CHAVES } from '@/server/integracoes/catalogo';
import { testarIntegracao } from '@/server/integracoes/testes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const params = z.object({ chave: z.enum(CHAVES) });
const corpo = z.object({ pergunta: z.string().trim().max(1000).optional() }).default({});

export async function POST(request: Request, ctx: { params: Promise<{ chave: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { chave } = params.parse(await ctx.params);
    const bruto = await request.json().catch(() => ({}));
    const { pergunta } = corpo.parse(bruto);
    return json(await testarIntegracao(chave, { pergunta }));
  });
}
