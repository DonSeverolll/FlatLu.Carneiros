import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import BookingWidget from '../../BookingWidget';
import CatalogoEspacos from '../../CatalogoEspacos';
import JsonLd from '../../JsonLd';
import { Perguntas, SiteFooter, SiteNav, Trilha } from '../../SiteChrome';
import {
  PAGINA_ALUGUEL,
  PAGINA_GUIA,
  caminhoDoEspaco,
  descricaoDoEspaco,
  perguntasFrequentes,
  precoAPartirDe,
  tituloDoEspaco
} from '@/server/seo/conteudo';
import { jsonLdEspaco, jsonLdPerguntas, jsonLdTrilha, jsonLdVideos } from '@/server/seo/jsonld';
import { carregarVitrine, fotosDoEspaco } from '@/server/seo/vitrine';
import { registrarVisitaDoGoogle } from '@/server/seo/painel';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

async function carregar(slug: string) {
  const vitrine = await carregarVitrine();
  const unit = vitrine.calendar?.units.find((u) => u.slug === slug) ?? null;
  return { ...vitrine, unit, fotos: fotosDoEspaco(vitrine.catalogo, slug) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { unit, fotos } = await carregar(slug);
  if (!unit) return { title: 'Espaço não encontrado', robots: { index: false } };
  const capa = fotos.find((f) => f.tipo === 'IMAGE');
  const titulo = tituloDoEspaco(unit);
  return {
    title: titulo,
    description: descricaoDoEspaco(unit),
    alternates: { canonical: caminhoDoEspaco(unit.slug) },
    openGraph: {
      title: titulo,
      description: descricaoDoEspaco(unit),
      url: caminhoDoEspaco(unit.slug),
      type: 'website',
      locale: 'pt_BR',
      ...(capa ? { images: [{ url: capa.url, alt: capa.descricao ?? titulo }] } : {})
    }
  };
}

export default async function EspacoPage({ params }: Props) {
  const { slug } = await params;
  const [{ calendar, catalogo, unit, fotos }] = await Promise.all([
    carregar(slug),
    registrarVisitaDoGoogle(caminhoDoEspaco(slug))
  ]);
  // Sem banco não dá para saber se o espaço existe: 404 só quando o calendário
  // respondeu e o espaço não está nele.
  if (calendar && !unit) notFound();

  if (!unit || !calendar) {
    return (
      <main>
        <SiteNav />
        <section className="seo-page">
          <h1>Espaço temporariamente indisponível</h1>
          <p>O calendário está fora do ar. Tente de novo em alguns minutos ou volte para a página inicial.</p>
          <Link className="button" href="/">
            Ir para o início
          </Link>
        </section>
      </main>
    );
  }

  const titulo = tituloDoEspaco(unit);
  const preco = precoAPartirDe(unit);
  const perguntas = perguntasFrequentes([unit]);
  const espacoCatalogo = catalogo.espacos.filter((e) => e.slug === unit.slug);
  const outros = calendar.units.filter((u) => u.slug !== unit.slug);
  const trilha = [
    { nome: 'Início', caminho: '/' },
    { nome: 'Aluguel de temporada em Carneiros', caminho: PAGINA_ALUGUEL },
    { nome: unit.shortName, caminho: caminhoDoEspaco(unit.slug) }
  ];

  return (
    <main>
      <JsonLd
        data={[
          jsonLdEspaco(unit, fotos.filter((f) => f.tipo === 'IMAGE').map((f) => ({ url: f.url, descricao: f.descricao }))),
          jsonLdTrilha(trilha),
          jsonLdPerguntas(perguntas),
          ...jsonLdVideos(
            titulo,
            fotos.filter((f) => f.tipo === 'VIDEO').map((f) => ({ url: f.url, miniatura: f.miniatura, descricao: f.descricao }))
          )
        ].filter(Boolean)}
      />
      <SiteNav fotos={fotos.length > 0} />

      <section className="seo-page">
        <Trilha itens={[trilha[0]!, trilha[1]!, { nome: unit.shortName }]} />
        <p className="eyebrow">{unit.locationName ?? 'Litoral sul de Pernambuco'}</p>
        <h1>{titulo}</h1>
        <p className="lead">{unit.description}</p>

        <dl className="facts seo-facts">
          <div>
            <dt>Hóspedes</dt>
            <dd>até {unit.maxGuests} pessoas</dd>
          </div>
          {preco && (
            <div>
              <dt>Diária</dt>
              <dd>a partir de {preco}</dd>
            </div>
          )}
          <div>
            <dt>Check-in</dt>
            <dd>
              {unit.checkInTime.slice(0, 5)} às {unit.checkInUntil.slice(0, 5)}
            </dd>
          </div>
          <div>
            <dt>Check-out</dt>
            <dd>até {unit.checkOutTime.slice(0, 5)}</dd>
          </div>
        </dl>

        {unit.amenities?.length > 0 && (
          <ul className="amenities">
            {unit.amenities.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}

        <p className="row-actions">
          <a className="button" href="#reserva">
            Ver datas livres de {unit.shortName}
          </a>
          {unit.locationUrl && (
            <a className="link" href={unit.locationUrl} rel="noreferrer" target="_blank">
              Ver no mapa
            </a>
          )}
        </p>
      </section>

      <CatalogoEspacos conta={catalogo.conta} espacos={espacoCatalogo} />

      <section className="booking-section" id="reserva">
        <BookingWidget calendar={calendar} initialUnit={unit.slug} />
      </section>

      <Perguntas perguntas={perguntas} />

      {outros.length > 0 && (
        <section className="seo-page seo-outros">
          <h2>Outros espaços</h2>
          <ul>
            {outros.map((o) => (
              <li key={o.slug}>
                <Link href={caminhoDoEspaco(o.slug)}>{tituloDoEspaco(o)}</Link> — até {o.maxGuests} pessoas
              </li>
            ))}
          </ul>
          <p>
            Vai conhecer a região? Leia o <Link href={PAGINA_GUIA}>guia da Praia dos Carneiros</Link>.
          </p>
        </section>
      )}

      <SiteFooter espacos={calendar.units} />
    </main>
  );
}
