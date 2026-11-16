import { SITE_NAME, absoluteUrl } from '@/lib/site';
import {
  CONTEUDO_ATUALIZADO_EM,
  CONTEUDO_PUBLICADO_EM,
  GUIA_RESUMO,
  GUIA_TITULO,
  caminhoDoEspaco,
  descricaoDoEspaco,
  tituloDoEspaco,
  type EspacoSeo,
  type Pergunta
} from './conteudo';

/**
 * Dados estruturados (schema.org em JSON-LD). É o que deixa o Google entender
 * "isto é uma hospedagem, neste lugar, a partir deste preço" em vez de adivinhar
 * pelo texto — e é o que habilita resultados ricos (preço, perguntas, fotos).
 */

type Foto = { url: string; descricao?: string | null };
type Video = { url: string; miniatura: string; descricao?: string | null; publicadoEm?: string | null };

/** "Praia de Carneiros, Tamandaré — PE" → cidade "Tamandaré", UF "PE". */
export function enderecoDe(local: string | null) {
  if (!local) return null;
  const [antes, uf] = local.split(/\s+[—-]\s+/);
  const partes = (antes ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const cidade = partes.at(-1) ?? null;
  return {
    '@type': 'PostalAddress',
    ...(partes.length > 1 ? { streetAddress: partes.slice(0, -1).join(', ') } : {}),
    ...(cidade ? { addressLocality: cidade } : {}),
    ...(uf ? { addressRegion: uf.trim() } : {}),
    addressCountry: 'BR'
  };
}

export function jsonLdSite() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: absoluteUrl('/'),
    inLanguage: 'pt-BR'
  };
}

export function jsonLdEspaco(espaco: EspacoSeo, fotos: Foto[] = []) {
  const cents = espaco.rates?.fromCents;
  return {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    '@id': absoluteUrl(`${caminhoDoEspaco(espaco.slug)}#hospedagem`),
    name: tituloDoEspaco(espaco),
    description: descricaoDoEspaco(espaco),
    url: absoluteUrl(caminhoDoEspaco(espaco.slug)),
    ...(fotos.length ? { image: fotos.slice(0, 10).map((f) => f.url) } : {}),
    ...(enderecoDe(espaco.locationName) ? { address: enderecoDe(espaco.locationName) } : {}),
    ...(espaco.locationUrl ? { hasMap: espaco.locationUrl } : {}),
    checkinTime: espaco.checkInTime.slice(0, 5),
    checkoutTime: espaco.checkOutTime.slice(0, 5),
    currenciesAccepted: 'BRL',
    paymentAccepted: 'Pix',
    ...(cents && cents > 0 ? { priceRange: `A partir de R$ ${(cents / 100).toFixed(0)} por noite` } : {}),
    containsPlace: {
      '@type': 'Accommodation',
      name: espaco.shortName,
      occupancy: { '@type': 'QuantitativeValue', maxValue: espaco.maxGuests, unitText: 'pessoas' }
    },
    ...(cents && cents > 0
      ? {
          makesOffer: {
            '@type': 'Offer',
            url: absoluteUrl(caminhoDoEspaco(espaco.slug)),
            availability: 'https://schema.org/InStock',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: (cents / 100).toFixed(2),
              priceCurrency: 'BRL',
              unitText: 'noite',
              valueAddedTaxIncluded: true
            }
          }
        }
      : {})
  };
}

export function jsonLdLista(espacos: EspacoSeo[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Flats e casas para alugar em Carneiros e São José da Coroa Grande — PE',
    itemListElement: espacos.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: tituloDoEspaco(e),
      url: absoluteUrl(caminhoDoEspaco(e.slug))
    }))
  };
}

export function jsonLdPerguntas(perguntas: Pergunta[]) {
  if (!perguntas.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: perguntas.map((p) => ({
      '@type': 'Question',
      name: p.pergunta,
      acceptedAnswer: { '@type': 'Answer', text: p.resposta }
    }))
  };
}

export function jsonLdGuia(caminho: string, pdf: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: GUIA_TITULO,
    description: GUIA_RESUMO,
    inLanguage: 'pt-BR',
    datePublished: CONTEUDO_PUBLICADO_EM,
    dateModified: CONTEUDO_ATUALIZADO_EM,
    mainEntityOfPage: absoluteUrl(caminho),
    author: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') },
    associatedMedia: {
      '@type': 'MediaObject',
      contentUrl: absoluteUrl(pdf),
      encodingFormat: 'application/pdf',
      name: `${GUIA_TITULO} (PDF)`
    }
  };
}

export function jsonLdVideos(nome: string, videos: Video[]) {
  return videos.map((v, i) => ({
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: `${nome} — vídeo ${i + 1}`,
    description: v.descricao || `${nome}: vídeo do espaço para aluguel de temporada.`,
    thumbnailUrl: v.miniatura,
    contentUrl: v.url,
    ...(v.publicadoEm ? { uploadDate: v.publicadoEm } : {})
  }));
}

export function jsonLdTrilha(itens: { nome: string; caminho: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: itens.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.nome,
      item: absoluteUrl(item.caminho)
    }))
  };
}
