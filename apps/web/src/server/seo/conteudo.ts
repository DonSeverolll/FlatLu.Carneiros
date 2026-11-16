import { brl } from '@/lib/format';

/**
 * Texto que o Google lê. Fica num lugar só porque o mesmo conteúdo vai para a
 * página HTML, para o PDF do guia e para os dados estruturados — se divergirem,
 * o Google desconfia e o hóspede também.
 *
 * Regra da casa: nada de preço, distância ou serviço inventado. O que depende
 * do espaço vem do banco; o que é da região fica em termos gerais e verificáveis.
 */

/** As buscas que queremos ganhar, na língua de quem procura. */
export const PALAVRAS_CHAVE = [
  'flat para alugar em Carneiros PE',
  'apartamento para alugar em Carneiros',
  'aluguel de temporada Praia dos Carneiros',
  'flat Praia dos Carneiros',
  'hospedagem Praia dos Carneiros',
  'aluguel temporada Tamandaré PE',
  'casa para alugar São José da Coroa Grande',
  'casa de praia litoral sul de Pernambuco'
];

/** Endereços das páginas de busca. A URL também é lida pelo Google (`inurl:`). */
export const PAGINA_ALUGUEL = '/aluguel-temporada-carneiros-pe';
export const PAGINA_GUIA = '/guia/praia-dos-carneiros';
export const PDF_GUIA = '/guia/praia-dos-carneiros.pdf';

/** Data de publicação e de revisão dos textos (filtros `after:` / `before:`). */
export const CONTEUDO_PUBLICADO_EM = '2026-11-16';
export const CONTEUDO_ATUALIZADO_EM = '2026-11-16';

/** O mínimo do espaço que o SEO usa; o tipo completo vem de `unitCalendar`. */
export type EspacoSeo = {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  locationName: string | null;
  locationUrl: string | null;
  maxGuests: number;
  minNights: number;
  checkInTime: string;
  checkInUntil: string;
  checkOutTime: string;
  depositPercentage: string;
  rates: { fromCents: number | null } | null;
};

export function precoAPartirDe(espaco: EspacoSeo): string | null {
  const cents = espaco.rates?.fromCents;
  return cents && cents > 0 ? brl(cents / 100) : null;
}

/** "na Praia de Carneiros…", "em São José…" — a preposição certa para o título. */
function noLocal(local: string): string {
  return /^praia\b/i.test(local) ? `na ${local}` : `em ${local}`;
}

export function caminhoDoEspaco(slug: string): string {
  return `/espacos/${encodeURIComponent(slug)}`;
}

/** Título com a busca dentro: tipo do imóvel + "para alugar" + lugar. */
export function tituloDoEspaco(espaco: EspacoSeo): string {
  const local = espaco.locationName ?? 'litoral sul de Pernambuco';
  return `${espaco.shortName} para alugar ${noLocal(local)}`;
}

export function descricaoDoEspaco(espaco: EspacoSeo): string {
  const preco = precoAPartirDe(espaco);
  const partes = [
    espaco.description.trim().replace(/\.?$/, '.'),
    `Até ${espaco.maxGuests} pessoas${preco ? `, diárias a partir de ${preco}` : ''}.`,
    'Calendário real e reserva online com sinal por Pix.'
  ];
  return partes.join(' ');
}

const hora = (valor: string) => valor.slice(0, 5);

export type Pergunta = { pergunta: string; resposta: string };

/** Perguntas frequentes montadas a partir dos dados reais de cada espaço. */
export function perguntasFrequentes(espacos: EspacoSeo[]): Pergunta[] {
  if (!espacos.length) return [];
  const lista: Pergunta[] = [];

  lista.push({
    pergunta: 'Quais espaços estão disponíveis para alugar?',
    resposta:
      espacos
        .map((e) => `${e.shortName} (${e.locationName ?? 'litoral sul de PE'}), para até ${e.maxGuests} pessoas`)
        .join('; ') +
      '. Cada espaço tem entrada, calendário e tarifa próprios: alugar um não ocupa o outro.'
  });

  const comPreco = espacos.filter((e) => precoAPartirDe(e));
  if (comPreco.length) {
    lista.push({
      pergunta: 'Quanto custa a diária?',
      resposta:
        comPreco.map((e) => `${e.shortName}: a partir de ${precoAPartirDe(e)} por noite`).join('; ') +
        '. O valor exato da sua estadia aparece na hora, no calendário, antes de reservar — sexta, sábado e feriados costumam custar mais.'
    });
  }

  const primeiro = espacos[0]!;
  lista.push({
    pergunta: 'Qual o horário de check-in e check-out?',
    resposta: `Check-in a partir das ${hora(primeiro.checkInTime)} até as ${hora(primeiro.checkInUntil)}; check-out até as ${hora(primeiro.checkOutTime)}.`
  });

  const sinais = [...new Set(espacos.map((e) => Number(e.depositPercentage)).filter((n) => n > 0))];
  lista.push({
    pergunta: 'Como faço a reserva?',
    resposta:
      'Escolha o espaço e as datas no calendário do site, confira o valor total e confirme. ' +
      (sinais.length === 1
        ? `A reserva é garantida com o sinal de ${sinais[0]}% por Pix.`
        : 'A reserva é garantida com o sinal por Pix.') +
      ' Você acompanha tudo na Área do hóspede.'
  });

  lista.push({
    pergunta: 'Onde ficam os espaços?',
    resposta:
      [...new Set(espacos.map((e) => e.locationName).filter(Boolean))].join(' e ') +
      ', no litoral sul de Pernambuco. O link do mapa está na página de cada espaço.'
  });

  return lista;
}

export type SecaoGuia = { id: string; titulo: string; paragrafos: string[] };

/**
 * Guia da região. Termos gerais de propósito: maré, horário de passeio e
 * cobrança de acesso mudam, e o guia diz onde conferir em vez de cravar números.
 */
export const GUIA_TITULO = 'Guia da Praia dos Carneiros e de São José da Coroa Grande';
export const GUIA_RESUMO =
  'O que fazer, quando ir e como aproveitar a Praia dos Carneiros (Tamandaré) e São José da Coroa Grande, no litoral sul de Pernambuco — com dicas de maré, passeios e hospedagem.';

export const GUIA: SecaoGuia[] = [
  {
    id: 'onde-fica',
    titulo: 'Onde fica a Praia dos Carneiros',
    paragrafos: [
      'A Praia dos Carneiros (também chamada de Praia de Carneiros) fica no município de Tamandaré, no litoral sul de Pernambuco, a cerca de duas horas de carro do Recife.',
      'A região faz parte da APA Costa dos Corais, uma área de proteção ambiental marinha: coqueirais, mar calmo e recifes que formam piscinas naturais.',
      'São José da Coroa Grande fica mais ao sul, no mesmo litoral, já perto da divisa com Alagoas — boa base para quem quer praia tranquila e casa espaçosa para a turma.'
    ]
  },
  {
    id: 'mare',
    titulo: 'Maré baixa: a hora das piscinas naturais',
    paragrafos: [
      'As piscinas naturais aparecem na maré baixa. Antes de sair, consulte a tábua de marés do dia (a Marinha do Brasil publica a previsão) e programe o passeio para esse horário.',
      'Em maré cheia o mar fica mais alto e os bancos de areia somem — ótimo para banho de rio e descanso, menos para caminhar até os recifes.'
    ]
  },
  {
    id: 'o-que-fazer',
    titulo: 'O que fazer',
    paragrafos: [
      'Visitar a Igrejinha de São Benedito, a capela à beira-mar que virou o cartão-postal de Carneiros.',
      'Passear de catamarã ou lancha pelo encontro do rio com o mar, com paradas para banho de argila e nas piscinas naturais.',
      'Em São José da Coroa Grande, aproveitar as piscinas naturais na maré baixa e o ritmo calmo das praias do extremo sul do estado.'
    ]
  },
  {
    id: 'dicas',
    titulo: 'Dicas práticas',
    paragrafos: [
      'Boa parte da orla de Carneiros é acessada por bares e restaurantes que cobram consumação ou day use: confira as condições antes de escolher onde ficar.',
      'Leve protetor solar, água e dinheiro ou Pix para os passeios. Respeite as regras da área de proteção: não pise nos corais e não leve nada do recife.',
      'Feriados, verão e réveillon lotam rápido. Reserve a hospedagem com antecedência e veja a disponibilidade real no calendário do site.'
    ]
  },
  {
    id: 'onde-ficar',
    titulo: 'Onde ficar',
    paragrafos: [
      'Para casal ou família pequena, o flat na Praia de Carneiros deixa você perto da igrejinha e dos passeios.',
      'Para turmas maiores, os dois andares da casa em São José da Coroa Grande são independentes — cada um com entrada própria — e podem ser alugados juntos ou separados.'
    ]
  }
];
