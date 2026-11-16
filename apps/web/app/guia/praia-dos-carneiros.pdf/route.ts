import { absoluteUrl } from '@/lib/site';
import {
  CONTEUDO_ATUALIZADO_EM,
  GUIA,
  GUIA_RESUMO,
  GUIA_TITULO,
  PAGINA_ALUGUEL,
  caminhoDoEspaco,
  precoAPartirDe,
  tituloDoEspaco
} from '@/server/seo/conteudo';
import { gerarPdf, type BlocoPdf } from '@/server/seo/pdf';
import { carregarCalendario } from '@/server/seo/vitrine';

export const dynamic = 'force-dynamic';

/**
 * O guia como arquivo PDF. Além de servir ao hóspede (salvar, imprimir,
 * mandar no grupo da viagem), coloca o site nas buscas `filetype:pdf`.
 */
export async function GET() {
  const { calendar } = await carregarCalendario();
  const blocos: BlocoPdf[] = [
    { tipo: 'titulo', texto: GUIA_TITULO },
    { tipo: 'pequeno', texto: `Atualizado em ${CONTEUDO_ATUALIZADO_EM.split('-').reverse().join('/')} · ${absoluteUrl('/')}` },
    { tipo: 'texto', texto: GUIA_RESUMO }
  ];
  for (const secao of GUIA) {
    blocos.push({ tipo: 'subtitulo', texto: secao.titulo });
    for (const p of secao.paragrafos) blocos.push({ tipo: 'texto', texto: p });
  }
  const units = calendar?.units ?? [];
  if (units.length) {
    blocos.push({ tipo: 'subtitulo', texto: 'Flat e casa para alugar' });
    for (const u of units) {
      const preco = precoAPartirDe(u);
      blocos.push({
        tipo: 'texto',
        texto: `${tituloDoEspaco(u)} — até ${u.maxGuests} pessoas${preco ? `, a partir de ${preco} por noite` : ''}. ${absoluteUrl(caminhoDoEspaco(u.slug))}`
      });
    }
  }
  blocos.push({ tipo: 'pequeno', texto: `Veja datas livres e reserve: ${absoluteUrl(PAGINA_ALUGUEL)}` });

  const pdf = gerarPdf(blocos, { titulo: GUIA_TITULO, autor: 'Apt Carneiros', rodape: absoluteUrl('/') });
  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="guia-praia-dos-carneiros.pdf"',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400'
    }
  });
}
