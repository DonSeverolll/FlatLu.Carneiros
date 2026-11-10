import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle } from '@/server/http';
import { baixarMidiaWhatsApp } from '@/server/atendimento/gateway';
import { midiaDaMensagem } from '@/server/atendimento/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ mensagemId: z.string().uuid() });

/**
 * Mídia de uma mensagem, só para administrador. Mídia do WhatsApp é buscada na
 * Cloud API na hora (a URL de lá expira em minutos e exige o token); anexo do
 * Instagram já vem com URL do CDN da Meta.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ mensagemId: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { mensagemId } = params.parse(await ctx.params);
    const m = await midiaDaMensagem(mensagemId);
    if (m.midia_id_provedor && !m.midia_id_provedor.startsWith('sim-')) {
      return baixarMidiaWhatsApp(m.midia_id_provedor);
    }
    if (m.midia_url?.startsWith('https://')) return Response.redirect(m.midia_url, 302);
    throw notFound('MEDIA_NOT_FOUND');
  });
}
