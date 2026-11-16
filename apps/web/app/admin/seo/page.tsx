import SeoView from './SeoView';
import { absoluteUrl, siteHost } from '@/lib/site';
import { buscasProntas } from '@/lib/buscaGoogle';
import { PAGINA_ALUGUEL, PAGINA_GUIA, PDF_GUIA } from '@/server/seo/conteudo';

export const dynamic = 'force-dynamic';

export default function Page() {
  const host = siteHost();
  return (
    <SeoView
      grupos={buscasProntas(host)}
      host={host}
      links={{
        site: absoluteUrl('/'),
        sitemap: absoluteUrl('/sitemap.xml'),
        robots: absoluteUrl('/robots.txt'),
        aluguel: absoluteUrl(PAGINA_ALUGUEL),
        guia: absoluteUrl(PAGINA_GUIA),
        pdf: absoluteUrl(PDF_GUIA)
      }}
      situacao={{
        dominioProprio: Boolean(process.env.SITE_URL?.trim()),
        verificacaoGoogle: Boolean(process.env.GOOGLE_SITE_VERIFICATION?.trim()),
        local: host.startsWith('localhost')
      }}
    />
  );
}
