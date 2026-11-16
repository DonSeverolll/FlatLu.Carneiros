import SeoView from './SeoView';
import { absoluteUrl, siteHost, siteUrl } from '@/lib/site';
import { buscasProntas } from '@/lib/buscaGoogle';
import { estadoDosPassos, visitasDoGoogle } from '@/server/seo/painel';
import { paginasDoSite } from '@/server/seo/paginas';

export const dynamic = 'force-dynamic';

/**
 * Tela SEO com o estado real: o que o site já publica, o que já foi feito no
 * Google (marcado pelo admin ou comprovado pelo próprio site) e quando o robô
 * do Google passou em cada página.
 */
export default async function Page() {
  const host = siteHost();
  const local = host.startsWith('localhost') || host.startsWith('127.');
  const configurado = process.env.SITE_URL?.trim() ?? '';
  const dominioProprio = Boolean(configurado) && !/\.vercel\.app$/i.test(configurado.replace(/\/+$/, ''));
  const verificacao = process.env.GOOGLE_SITE_VERIFICATION?.trim() ?? '';

  const [paginas, visitas] = await Promise.all([paginasDoSite(), visitasDoGoogle()]);
  const sitemapLidoEm = visitas.get('/sitemap.xml')?.ultima ?? null;
  const passos = await estadoDosPassos({
    verificacaoGoogle: Boolean(verificacao),
    dominioProprio,
    sitemapLidoEm
  });

  return (
    <SeoView
      grupos={buscasProntas(host)}
      host={host}
      links={{
        site: absoluteUrl('/'),
        sitemap: absoluteUrl('/sitemap.xml'),
        robots: absoluteUrl('/robots.txt'),
        searchConsole: `https://search.google.com/search-console?resource_id=${encodeURIComponent(`${siteUrl()}/`)}`
      }}
      paginas={paginas.map((p) => {
        const v = visitas.get(p.caminho);
        return {
          caminho: p.caminho,
          url: absoluteUrl(p.caminho),
          titulo: p.titulo,
          tipo: p.tipo,
          fotos: p.fotos.length,
          videos: p.videos.length,
          ultimaVisitaGoogle: v?.ultima ?? null,
          visitas30d: v?.visitas30d ?? 0
        };
      })}
      passos={passos}
      situacao={{
        local,
        dominioProprio,
        verificacao: verificacao ? `${verificacao.slice(0, 6)}…` : null,
        sitemapLidoEm
      }}
    />
  );
}
