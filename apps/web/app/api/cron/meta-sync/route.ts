import { config } from '@/server/config';
import { secretMatches } from '@/server/auth';
import { unauthorized } from '@/server/errors';
import { handle, json } from '@/server/http';
import { sincronizarAnuncios } from '@/server/meta/ads';
import { credAds, credInstagram } from '@/server/integracoes/store';
import { sincronizarCatalogo } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Sincronização diária das métricas de anúncios e do catálogo do Instagram
 * (as URLs das fotos expiram em dias; renovar todo dia mantém o site no ar). Sem credencial da Meta, sai
 * em silêncio com `skipped` — o cron não pode virar alarme diário enquanto a
 * integração ainda não foi ligada.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const header = request.headers.get('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!presented || !secretMatches(config.cronSecret, presented)) throw unauthorized();

    // Cada parte independe da outra: falha nos anúncios não pode deixar as
    // fotos do catálogo com URL vencida, e vice-versa.
    const anuncios = (await credAds()).configurado
      ? await sincronizarAnuncios(30).catch((e: { code?: string }) => ({ erro: e.code ?? 'ERRO' }))
      : { skipped: 'META_ADS_NOT_CONFIGURED' };
    const ig = await credInstagram();
    const catalogo =
      ig.igAccountId && ig.pageToken
        ? await sincronizarCatalogo().catch((e: { code?: string }) => ({ erro: e.code ?? 'ERRO' }))
        : { skipped: 'INSTAGRAM_NOT_CONFIGURED' };
    return json({ anuncios, catalogo });
  });
}
