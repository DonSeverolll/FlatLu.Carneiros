import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site';
import {
  CONTEUDO_ATUALIZADO_EM,
  GUIA_TITULO,
  PAGINA_ALUGUEL,
  PAGINA_GUIA,
  PDF_GUIA,
  caminhoDoEspaco,
  tituloDoEspaco
} from './conteudo';
import { carregarVitrine, fotosDoEspaco } from './vitrine';

/**
 * As páginas públicas do site — a mesma lista vira o sitemap.xml (para o
 * Google) e a tabela de páginas da tela SEO (para o administrador). Uma fonte
 * só: página nova que entra no sitemap aparece no painel sem esforço.
 */
export type PaginaDoSite = {
  caminho: string;
  titulo: string;
  tipo: 'Início' | 'Aluguel' | 'Espaço' | 'Guia' | 'PDF';
  fotos: string[];
  videos: { titulo: string; miniatura: string; descricao: string; url: string }[];
  /** Só para conteúdo com data de revisão real; páginas vivas não informam. */
  atualizadoEm?: string;
  frequencia: 'daily' | 'weekly' | 'monthly';
  prioridade: number;
};

export async function paginasDoSite(): Promise<PaginaDoSite[]> {
  const { calendar, catalogo } = await carregarVitrine();
  const capas = catalogo.espacos.flatMap((e) =>
    e.fotos.filter((f) => f.tipo === 'IMAGE').slice(0, 3).map((f) => f.url)
  );

  const paginas: PaginaDoSite[] = [
    { caminho: '/', titulo: 'Flat para alugar em Carneiros PE', tipo: 'Início', fotos: capas, videos: [], frequencia: 'daily', prioridade: 1 },
    { caminho: PAGINA_ALUGUEL, titulo: 'Flat e apartamento para alugar em Carneiros – PE', tipo: 'Aluguel', fotos: [], videos: [], frequencia: 'weekly', prioridade: 0.9 },
    { caminho: PAGINA_GUIA, titulo: GUIA_TITULO, tipo: 'Guia', fotos: [], videos: [], atualizadoEm: CONTEUDO_ATUALIZADO_EM, frequencia: 'monthly', prioridade: 0.7 },
    { caminho: PDF_GUIA, titulo: `${GUIA_TITULO} (PDF)`, tipo: 'PDF', fotos: [], videos: [], atualizadoEm: CONTEUDO_ATUALIZADO_EM, frequencia: 'monthly', prioridade: 0.5 }
  ];

  for (const unit of calendar?.units ?? []) {
    const fotos = fotosDoEspaco(catalogo, unit.slug);
    paginas.push({
      caminho: caminhoDoEspaco(unit.slug),
      titulo: tituloDoEspaco(unit),
      tipo: 'Espaço',
      fotos: fotos.filter((f) => f.tipo === 'IMAGE').map((f) => f.url),
      videos: fotos
        .filter((f) => f.tipo === 'VIDEO')
        .map((f, i) => ({
          titulo: `${tituloDoEspaco(unit)} — vídeo ${i + 1}`,
          miniatura: f.miniatura,
          descricao: f.descricao || `Vídeo do espaço ${unit.shortName} para aluguel de temporada.`,
          url: f.url
        })),
      frequencia: 'daily',
      prioridade: 0.9
    });
  }
  return paginas;
}

export function paraSitemap(paginas: PaginaDoSite[]): MetadataRoute.Sitemap {
  return paginas.map((p) => ({
    url: absoluteUrl(p.caminho),
    ...(p.atualizadoEm ? { lastModified: p.atualizadoEm } : {}),
    changeFrequency: p.frequencia,
    priority: p.prioridade,
    ...(p.fotos.length ? { images: p.fotos } : {}),
    ...(p.videos.length
      ? {
          videos: p.videos.map((v) => ({
            title: v.titulo,
            thumbnail_loc: v.miniatura,
            description: v.descricao,
            content_loc: v.url
          }))
        }
      : {})
  }));
}
