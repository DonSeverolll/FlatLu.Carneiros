import type { Metadata } from 'next';
import Link from 'next/link';
import BookingWidget from './BookingWidget';
import CatalogoEspacos from './CatalogoEspacos';
import JsonLd from './JsonLd';
import { Perguntas, SiteFooter } from './SiteChrome';
import { PAGINA_ALUGUEL, PAGINA_GUIA, caminhoDoEspaco, perguntasFrequentes, precoAPartirDe } from '@/server/seo/conteudo';
import { jsonLdLista, jsonLdPerguntas, jsonLdSite } from '@/server/seo/jsonld';
import { carregarCatalogo, carregarVitrine } from '@/server/seo/vitrine';
import { registrarVisitaDoGoogle } from '@/server/seo/painel';

export const dynamic = 'force-dynamic';

/**
 * A vitrine é um Server Component: o calendário das três unidades vem direto da
 * camada de servidor, sem roundtrip HTTP para a própria aplicação. Se o banco
 * estiver indisponível, a página continua no ar em modo degradado — apresentar
 * os espaços não depende da infraestrutura de reservas.
 */
export async function generateMetadata(): Promise<Metadata> {
  // A foto de capa vira a imagem do link compartilhado (WhatsApp, Instagram).
  const catalogo = await carregarCatalogo();
  const capa = catalogo.espacos[0]?.fotos.find((f) => f.capa && f.tipo === 'IMAGE');
  return {
    alternates: { canonical: '/' },
    ...(capa
      ? { openGraph: { images: [{ url: capa.url, alt: capa.descricao ?? 'Flat para alugar na Praia dos Carneiros' }] } }
      : {})
  };
}

export default async function HomePage() {
  const [{ calendar, error, catalogo }] = await Promise.all([carregarVitrine(), registrarVisitaDoGoogle('/')]);
  const perguntas = perguntasFrequentes(calendar?.units ?? []);
  // A foto de abertura é a capa do primeiro espaço com catálogo; sem ela,
  // fica a imagem genérica do CSS.
  const capa = catalogo.espacos[0]?.fotos.find((f) => f.capa && f.tipo === 'IMAGE') ?? null;

  // Agrupa por endereço: dois locais, três espaços.
  const locations = new Map<string, { url: string | null; units: string[] }>();
  for (const unit of calendar?.units ?? []) {
    const key = unit.locationName ?? 'Localização a confirmar';
    const entry = locations.get(key) ?? { url: unit.locationUrl, units: [] };
    entry.units.push(unit.shortName);
    locations.set(key, entry);
  }

  return (
    <main>
      <JsonLd
        data={[jsonLdSite(), calendar ? jsonLdLista(calendar.units) : null, jsonLdPerguntas(perguntas)].filter(Boolean)}
      />
      <nav className="nav">
        <strong>APT CARNEIROS · FLAT &amp; CASA</strong>
        <span className="nav-links">
          {catalogo.espacos.length > 0 && <a href="#espacos">Fotos dos espaços</a>}
          <Link href={PAGINA_GUIA}>Guia da praia</Link>
          <a href="#reserva">Consultar datas</a>
        </span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Aluguel de temporada · Carneiros e São José da Coroa Grande — PE</p>
          <h1>Flat para alugar na Praia dos Carneiros.</h1>
          <p className="tagline">Seu intervalo entre o mar e o tempo.</p>
          <p className="lead">
            Três espaços independentes no litoral sul de Pernambuco: o flat na Praia de Carneiros e
            os dois andares da casa em São José da Coroa Grande, cada um com entrada própria.
          </p>
          <a className="button" href="#reserva">
            Ver disponibilidade
          </a>
        </div>
        <div
          aria-label={capa?.descricao ?? 'Área de lazer com piscina'}
          className="hero-image"
          role="img"
          style={
            capa
              ? {
                  backgroundImage: `linear-gradient(145deg, rgba(23,63,69,.05), rgba(23,63,69,.35)), url(${JSON.stringify(capa.url)})`
                }
              : undefined
          }
        />
      </section>

      <section className="details">
        <div>
          <p className="eyebrow">Os espaços</p>
          <h2>Escolha o tamanho da sua turma.</h2>
        </div>
        <div>
          <p>
            Cada espaço tem calendário e tarifa próprios — alugar um não ocupa o outro. Disponibilidade
            real, reserva com sinal por Pix e confirmação transparente.
          </p>

          {calendar ? (
            <dl className="facts stacked">
              {calendar.units.map((unit) => (
                <div key={unit.slug}>
                  <dt>
                    <i className="unit-dot" style={{ background: unit.color }} />{' '}
                    <Link href={caminhoDoEspaco(unit.slug)}>{unit.shortName}</Link>
                  </dt>
                  <dd>
                    até {unit.maxGuests} pessoas
                    {precoAPartirDe(unit) ? ` · a partir de ${precoAPartirDe(unit)}` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {calendar?.units[0] && (
            <p className="hint schedule">
              <strong>Check-in</strong> a partir das {calendar.units[0].checkInTime.slice(0, 5)} até
              as {calendar.units[0].checkInUntil.slice(0, 5)}. <strong>Check-out</strong>
              {' '}impreterivelmente até as {calendar.units[0].checkOutTime.slice(0, 5)}.
            </p>
          )}

          <div className="amenities">
            {[...locations].map(([name, entry]) => (
              <span key={name}>
                {entry.url ? (
                  <a href={entry.url} rel="noreferrer" target="_blank">
                    {name}
                  </a>
                ) : (
                  name
                )}
                {` · ${entry.units.join(', ')}`}
              </span>
            ))}
          </div>
        </div>
      </section>

      <CatalogoEspacos conta={catalogo.conta} espacos={catalogo.espacos} />

      <section className="booking-section" id="reserva">
        {calendar ? (
          <BookingWidget calendar={calendar} />
        ) : (
          <div className="booking-widget">
            <p className="feedback">{error}</p>
            <p>
              Escreva para o anfitrião e reservamos suas datas manualmente enquanto o sistema volta.
            </p>
          </div>
        )}
      </section>

      <Perguntas perguntas={perguntas} />
      <p className="seo-page hint">
        Compare os espaços em <Link href={PAGINA_ALUGUEL}>flat e apartamento para alugar em Carneiros</Link>.
      </p>
      <SiteFooter espacos={calendar?.units ?? []} />
    </main>
  );
}
