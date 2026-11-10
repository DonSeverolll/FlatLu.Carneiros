import { z } from 'zod';
import { recordAudit } from '@/server/audit';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { CHAVES } from '@/server/integracoes/catalogo';
import { removerIntegracao, salvarIntegracao, salvarSchema } from '@/server/integracoes/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ chave: z.enum(CHAVES) });
type Ctx = { params: Promise<{ chave: string }> };

/** Grava a integração. Segredos chegam em claro só aqui e saem cifrados. */
export async function PUT(request: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { chave } = params.parse(await ctx.params);
    const input = await parseBody(request, salvarSchema);
    const r = await salvarIntegracao(chave, input, session.id);
    await recordAudit({
      actorUserId: session.id,
      entityType: 'INTEGRACAO',
      eventType: 'INTEGRACAO_SALVA',
      // Só os NOMES dos campos alterados — nunca os valores.
      metadata: { chave, campos: r.camposAlterados }
    });
    return json({ ok: true });
  });
}

/** Apaga o que foi salvo no painel; volta a valer o que estiver na env. */
export async function DELETE(request: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { chave } = params.parse(await ctx.params);
    await removerIntegracao(chave);
    await recordAudit({
      actorUserId: session.id,
      entityType: 'INTEGRACAO',
      eventType: 'INTEGRACAO_REMOVIDA',
      metadata: { chave }
    });
    return json({ ok: true });
  });
}
