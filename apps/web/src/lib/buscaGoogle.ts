/**
 * Montador de buscas avançadas do Google (operadores + filtros da interface).
 *
 * Serve à tela SEO do painel: conferir se o Google já indexou o site, em que
 * posição aparecemos, o que a concorrência anuncia e onde falam de nós. Cada
 * busca vira um link que já abre o Google com a aba, o período, o "ao pé da
 * letra" e o SafeSearch certos — os mesmos que o menu "Ferramentas" ofereceria.
 */

export type Aba = 'web' | 'imagens' | 'noticias' | 'videos' | 'shopping';
export type Periodo = 'qualquer' | 'hora' | 'dia' | 'semana' | 'mes' | 'ano';
export type SafeSearch = 'padrao' | 'filtrar' | 'desativado';

export type OpcoesBusca = {
  /** Palavras soltas. */
  termos?: string;
  /** Frases exatas — vão entre aspas. */
  exatas?: string[];
  /** Alternativas — viram (a OR b OR c). */
  alternativas?: string[];
  /** Palavras ou sites a excluir (com -). Um domínio vira -site:dominio. */
  excluir?: string[];
  /** Domínios ou extensões (site:). Mais de um vira (site:a OR site:b). */
  sites?: string[];
  tipoArquivo?: string;
  noTitulo?: string;
  naUrl?: string;
  /** AAAA-MM-DD */
  depoisDe?: string;
  antesDe?: string;
};

export type Filtros = {
  aba?: Aba;
  periodo?: Periodo;
  aoPeDaLetra?: boolean;
  safe?: SafeSearch;
};

const aspas = (s: string) => `"${s.replace(/"/g, '').trim()}"`;
const temEspaco = (s: string) => /\s/.test(s.trim());
const limpo = (lista?: string[]) => (lista ?? []).map((s) => s.trim()).filter(Boolean);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DOMINIO = /^[\w-]+(\.[\w-]+)+$/;

function grupo(itens: string[]): string {
  return itens.length > 1 ? `(${itens.join(' OR ')})` : (itens[0] ?? '');
}

/** Monta a string de busca (o que vai na barra do Google). */
export function montarConsulta(o: OpcoesBusca): string {
  const partes: string[] = [];
  if (o.termos?.trim()) partes.push(o.termos.trim());
  for (const frase of limpo(o.exatas)) partes.push(aspas(frase));
  const alt = limpo(o.alternativas).map((a) => (temEspaco(a) ? aspas(a) : a));
  if (alt.length) partes.push(grupo(alt));
  if (o.noTitulo?.trim()) partes.push(`intitle:${temEspaco(o.noTitulo) ? aspas(o.noTitulo) : o.noTitulo.trim()}`);
  if (o.naUrl?.trim()) partes.push(`inurl:${o.naUrl.trim().replace(/\s+/g, '-')}`);
  const sites = limpo(o.sites).map((s) => `site:${s.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`);
  if (sites.length) partes.push(grupo(sites));
  if (o.tipoArquivo?.trim()) partes.push(`filetype:${o.tipoArquivo.trim().replace(/^\./, '').toLowerCase()}`);
  for (const fora of limpo(o.excluir)) {
    if (DOMINIO.test(fora)) partes.push(`-site:${fora}`);
    else partes.push(`-${temEspaco(fora) ? aspas(fora) : fora}`);
  }
  if (o.depoisDe && DATA.test(o.depoisDe)) partes.push(`after:${o.depoisDe}`);
  if (o.antesDe && DATA.test(o.antesDe)) partes.push(`before:${o.antesDe}`);
  return partes.join(' ');
}

const ABA_PARAM: Record<Aba, string | null> = {
  web: null,
  imagens: 'isch',
  noticias: 'nws',
  videos: 'vid',
  shopping: 'shop'
};
const PERIODO_PARAM: Record<Periodo, string | null> = {
  qualquer: null,
  hora: 'qdr:h',
  dia: 'qdr:d',
  semana: 'qdr:w',
  mes: 'qdr:m',
  ano: 'qdr:y'
};

/** Link do Google já com a aba e os filtros de "Ferramentas" aplicados. */
export function linkGoogle(consulta: string, filtros: Filtros = {}): string {
  const p = new URLSearchParams({ q: consulta, hl: 'pt-BR', gl: 'br' });
  const tbm = ABA_PARAM[filtros.aba ?? 'web'];
  if (tbm) p.set('tbm', tbm);
  const tbs = [PERIODO_PARAM[filtros.periodo ?? 'qualquer'], filtros.aoPeDaLetra ? 'li:1' : null].filter(Boolean);
  if (tbs.length) p.set('tbs', tbs.join(','));
  if (filtros.safe === 'filtrar') p.set('safe', 'active');
  if (filtros.safe === 'desativado') p.set('safe', 'off');
  return `https://www.google.com/search?${p.toString()}`;
}

const NOME_ABA: Record<Aba, string> = {
  web: 'Web (Todas)',
  imagens: 'Imagens',
  noticias: 'Notícias',
  videos: 'Vídeos',
  shopping: 'Shopping'
};
const NOME_PERIODO: Record<Periodo, string> = {
  qualquer: 'Em qualquer data',
  hora: 'Na última hora',
  dia: 'Últimas 24 horas',
  semana: 'Na última semana',
  mes: 'No último mês',
  ano: 'No último ano'
};

/** Como achar os mesmos filtros clicando, para quem prefere a interface. */
export function descreverFiltros(filtros: Filtros = {}): string[] {
  const passos = [`Aba: ${NOME_ABA[filtros.aba ?? 'web']}`];
  if (filtros.periodo && filtros.periodo !== 'qualquer') {
    passos.push(`Ferramentas › Em qualquer data › ${NOME_PERIODO[filtros.periodo]}`);
  }
  if (filtros.aoPeDaLetra) passos.push('Ferramentas › Todos os resultados › Ao pé da letra');
  if (filtros.safe === 'desativado') passos.push('SafeSearch: Desativado');
  else if (filtros.safe === 'filtrar') passos.push('SafeSearch: Filtrar');
  else passos.push('SafeSearch: não precisa mudar');
  return passos;
}

/** Data AAAA-MM-DD de N meses atrás, para `after:`. */
export function mesesAtras(meses: number, hoje = new Date()): string {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - meses, hoje.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

export type BuscaPronta = {
  titulo: string;
  objetivo: string;
  opcoes: OpcoesBusca;
  filtros: Filtros;
};

export type GrupoBuscas = { titulo: string; descricao: string; buscas: BuscaPronta[] };

/** As buscas que o dono do site deve rodar de tempos em tempos. */
export function buscasProntas(host: string, hoje = new Date()): GrupoBuscas[] {
  const umAno = mesesAtras(12, hoje);
  return [
    {
      titulo: 'O Google já encontrou o site?',
      descricao: 'Se estas buscas vierem vazias, o site ainda não foi indexado: envie o sitemap no Search Console.',
      buscas: [
        {
          titulo: 'Todas as páginas indexadas',
          objetivo: 'Lista o que o Google guardou do site; o número aproximado aparece no topo.',
          opcoes: { sites: [host] },
          filtros: { aba: 'web' }
        },
        {
          titulo: 'Páginas de cada espaço',
          objetivo: 'Confere se as páginas de flat e casa já aparecem com o título certo.',
          opcoes: { sites: [host], naUrl: 'espacos', alternativas: ['flat', 'casa'] },
          filtros: { aba: 'web' }
        },
        {
          titulo: 'Guia em PDF',
          objetivo: 'Confere se o guia em PDF foi indexado (aparece nas buscas por arquivo).',
          opcoes: { sites: [host], tipoArquivo: 'pdf' },
          filtros: { aba: 'web' }
        },
        {
          titulo: 'Fotos no Google Imagens',
          objetivo: 'Mostra quais fotos do site já aparecem na aba Imagens.',
          opcoes: { sites: [host] },
          filtros: { aba: 'imagens' }
        }
      ]
    },
    {
      titulo: 'Em que posição aparecemos',
      descricao: 'Busque como o hóspede busca. "Ao pé da letra" evita que o Google troque as palavras.',
      buscas: [
        {
          titulo: 'Flat para alugar em Carneiros',
          objetivo: 'A busca principal: veja em que posição o site aparece.',
          opcoes: { termos: 'flat para alugar', alternativas: ['Carneiros', 'Praia dos Carneiros'] },
          filtros: { aba: 'web', aoPeDaLetra: true }
        },
        {
          titulo: 'Apartamento para alugar em Carneiros',
          objetivo: 'Mesma busca com "apartamento", que muita gente usa no lugar de "flat".',
          opcoes: { termos: 'apartamento para alugar', exatas: ['Carneiros'], alternativas: ['PE', 'Tamandaré'] },
          filtros: { aba: 'web', aoPeDaLetra: true }
        },
        {
          titulo: 'Casa de temporada em São José da Coroa Grande',
          objetivo: 'A busca de quem procura espaço para turma grande.',
          opcoes: { exatas: ['São José da Coroa Grande'], alternativas: ['casa para alugar', 'aluguel de temporada'] },
          filtros: { aba: 'web' }
        }
      ]
    },
    {
      titulo: 'O que a concorrência anuncia',
      descricao: 'Anúncios recentes de flats e apartamentos na região, fora do nosso site.',
      buscas: [
        {
          titulo: 'Títulos de anúncios no último ano',
          objetivo: 'Páginas com "flat" ou "apartamento" no título falando de Carneiros, publicadas no último ano.',
          opcoes: {
            noTitulo: 'Carneiros',
            alternativas: ['flat', 'apartamento'],
            exatas: ['para alugar'],
            excluir: [host, 'venda'],
            depoisDe: umAno
          },
          filtros: { aba: 'web', periodo: 'ano' }
        },
        {
          titulo: 'Anúncios no Airbnb e no Booking',
          objetivo: 'Como os concorrentes descrevem e precificam os imóveis nas plataformas.',
          opcoes: { exatas: ['Carneiros'], sites: ['airbnb.com.br', 'booking.com'], alternativas: ['flat', 'apartamento', 'casa'] },
          filtros: { aba: 'web' }
        },
        {
          titulo: 'Endereços com "carneiros" na URL',
          objetivo: 'Sites e páginas dedicadas à praia — possíveis parceiros ou concorrentes diretos.',
          opcoes: { naUrl: 'carneiros', alternativas: ['aluguel', 'temporada', 'hospedagem'], excluir: [host] },
          filtros: { aba: 'web' }
        }
      ]
    },
    {
      titulo: 'Quem fala de nós',
      descricao: 'Menções, avaliações e conteúdo que pode virar link para o site.',
      buscas: [
        {
          titulo: 'Menções ao nome',
          objetivo: 'Onde o nome aparece fora do site (redes, blogs, avaliações).',
          opcoes: { alternativas: ['Apt Carneiros', 'Flat Carneiros'], excluir: [host] },
          filtros: { aba: 'web', aoPeDaLetra: true }
        },
        {
          titulo: 'Notícias da Praia dos Carneiros',
          objetivo: 'Notícias recentes da região — pauta para o Instagram e para o guia.',
          opcoes: { exatas: ['Praia dos Carneiros'] },
          filtros: { aba: 'noticias', periodo: 'mes' }
        },
        {
          titulo: 'Vídeos da região',
          objetivo: 'Vídeos recentes sobre Carneiros: ideias de conteúdo e canais para parceria.',
          opcoes: { alternativas: ['Praia dos Carneiros', 'Carneiros PE'] },
          filtros: { aba: 'videos', periodo: 'ano' }
        },
        {
          titulo: 'Guias e roteiros em PDF',
          objetivo: 'Material de turismo em PDF (prefeituras, governo) para citar e pedir link.',
          opcoes: { exatas: ['Carneiros'], tipoArquivo: 'pdf', alternativas: ['guia', 'roteiro', 'turismo'], sites: ['gov.br'] },
          filtros: { aba: 'web' }
        }
      ]
    }
  ];
}
