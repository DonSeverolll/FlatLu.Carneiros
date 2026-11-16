import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site';
import {
  CONTEUDO_ATUALIZADO_EM,
  PAGINA_ALUGUEL,
  PAGINA_GUIA,
  PDF_GUIA,
  caminhoDoEspaco,
  tituloDoEspaco
} from '@/server/seo/conteudo';
import { carregarVitrine, fotosDoEspaco } from '@/server/seo/vitrine';

// Sem lastModified nas páginas vivas: data "de agora" a cada visita ensina o
// Google a ignorar o campo. Só o guia, que tem data de revisão real, informa.
// Lê o banco a cada pedido: espaço novo ou foto aprovada entram no sitemap
// sem precisar de deploy.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { calendar, catalogo } = await carregarVitrine();
  const fotosDe = (slug: string) => fotosDoEspaco(catalogo, slug);

  const capas = catalogo.espacos.flatMap((e) => e.fotos.filter((f) => f.tipo === 'IMAGE').slice(0, 3).map((f) => f.url));

  const entradas: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), changeFrequency: 'daily', priority: 1, images: capas },
    { url: absoluteUrl(PAGINA_ALUGUEL), changeFrequency: 'weekly', priority: 0.9 },
    { url: absoluteUrl(PAGINA_GUIA), lastModified: CONTEUDO_ATUALIZADO_EM, changeFrequency: 'monthly', priority: 0.7 },
    { url: absoluteUrl(PDF_GUIA), lastModified: CONTEUDO_ATUALIZADO_EM, changeFrequency: 'monthly', priority: 0.5 }
  ];

  for (const unit of calendar?.units ?? []) {
    const fotos = fotosDe(unit.slug);
    entradas.push({
      url: absoluteUrl(caminhoDoEspaco(unit.slug)),
      changeFrequency: 'daily',
      priority: 0.9,
      images: fotos.filter((f) => f.tipo === 'IMAGE').map((f) => f.url),
      videos: fotos
        .filter((f) => f.tipo === 'VIDEO')
        .map((f, i) => ({
          title: `${tituloDoEspaco(unit)} — vídeo ${i + 1}`,
          thumbnail_loc: f.miniatura,
          description: f.descricao || `Vídeo do espaço ${unit.shortName} para aluguel de temporada.`,
          content_loc: f.url
        }))
    });
  }
  return entradas;
}
