/**
 * Regras puras do catálogo: transformar a resposta da API do Instagram em
 * linhas e sugerir o espaço de cada foto pela legenda. Sem rede, sem banco.
 */

export type MidiaApi = {
  id?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  children?: { data?: MidiaApi[] };
};

export type LinhaMidia = {
  igMediaId: string;
  albumId: string | null;
  tipo: 'IMAGE' | 'VIDEO';
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  legenda: string | null;
  publicadoEm: string | null;
};

const ID = /^\d{5,40}$/;
/**
 * Só https — exceto localhost fora de produção, que é a Graph API simulada
 * dos testes de ponta a ponta.
 */
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
const https = (u: string | undefined) =>
  u && (/^https:\/\//.test(u) || (process.env.NODE_ENV !== 'production' && LOCAL.test(u))) ? u : null;

/**
 * Post simples vira uma linha; carrossel vira uma linha por item, todas com a
 * legenda e a data do post (os itens de carrossel não têm legenda própria).
 * Item sem id ou sem URL https é descartado em vez de quebrar a sincronização.
 */
export function achatarMidias(itens: MidiaApi[]): LinhaMidia[] {
  const linhas: LinhaMidia[] = [];
  for (const item of itens) {
    if (!item.id || !ID.test(item.id)) continue;
    const legenda = item.caption?.trim() || null;
    const publicadoEm = item.timestamp ? new Date(item.timestamp).toISOString() : null;

    const filhos = item.media_type === 'CAROUSEL_ALBUM' ? (item.children?.data ?? []) : [item];
    for (const filho of filhos) {
      if (!filho.id || !ID.test(filho.id)) continue;
      const tipo = filho.media_type === 'VIDEO' ? 'VIDEO' : filho.media_type === 'IMAGE' || !filho.media_type ? 'IMAGE' : null;
      if (!tipo) continue;
      const mediaUrl = https(filho.media_url);
      const thumbnailUrl = https(filho.thumbnail_url);
      if (!mediaUrl && !thumbnailUrl) continue;
      linhas.push({
        igMediaId: filho.id,
        albumId: item.media_type === 'CAROUSEL_ALBUM' ? item.id : null,
        tipo,
        mediaUrl,
        thumbnailUrl,
        permalink: https(item.permalink),
        legenda,
        publicadoEm
      });
    }
  }
  return linhas;
}

const semAcento = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export type EspacoPalavras = { id: string; nome: string; palavras: string[] };

/**
 * Espaço sugerido pela legenda. Precisa de UM espaço só: uma legenda que cita
 * o flat e a casa ("nossos três espaços") não diz de qual é a foto, e
 * adivinhar seria pior que deixar para a revisão.
 */
export function classificarPorLegenda(
  legenda: string | null,
  espacos: EspacoPalavras[]
): { propertyId: string; motivo: string } | null {
  if (!legenda) return null;
  const texto = ` ${semAcento(legenda).replace(/[^a-z0-9º#@]+/g, ' ')} `;
  const encontrados = espacos
    .map((e) => ({
      espaco: e,
      palavra: e.palavras.find((p) => {
        const alvo = semAcento(p).replace(/[^a-z0-9º#@]+/g, ' ').trim();
        return alvo && texto.includes(` ${alvo} `);
      })
    }))
    .filter((x) => x.palavra);
  if (encontrados.length !== 1) return null;
  const [unico] = encontrados;
  return { propertyId: unico!.espaco.id, motivo: `legenda cita "${unico!.palavra}"` };
}
