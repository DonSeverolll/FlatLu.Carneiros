import Link from 'next/link';
import BookingWidget from './BookingWidget';
import { config } from '@/server/config';
import { findProperty, publicProperty, unavailableNights } from '@/server/property';
import type { PublicPropertyDto } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * A vitrine é um Server Component: os dados vêm direto da camada de servidor,
 * sem um roundtrip HTTP para a própria aplicação. Se o banco ainda não estiver
 * configurado, a página continua no ar em modo degradado — a apresentação do
 * imóvel não depende da infraestrutura de reservas.
 */
async function loadShowcase(): Promise<{
  property: PublicPropertyDto | null;
  unavailable: string[];
  from: string | null;
  error: string | null;
}> {
  try {
    const property = await findProperty(config.propertySlug);
    const availability = await unavailableNights(property);
    return {
      property: publicProperty(property),
      unavailable: availability.unavailable,
      from: availability.from,
      error: null
    };
  } catch (error) {
    console.error('[showcase]', error);
    return {
      property: null,
      unavailable: [],
      from: null,
      error: 'Calendário temporariamente indisponível.'
    };
  }
}

export default async function HomePage() {
  const { property, unavailable, from, error } = await loadShowcase();
  const amenities = property?.amenities?.length
    ? property.amenities
    : ['1 quarto', '2 banheiros', 'Piscina', 'Garagem', 'Wi-Fi'];

  return (
    <main>
      <nav className="nav">
        <strong>CARNEIROS / FLAT</strong>
        <span className="nav-links">
          <a href="#reserva">Consultar datas</a>
          <Link href="/conta">Minha conta</Link>
        </span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Praia de Carneiros, Pernambuco</p>
          <h1>Seu intervalo entre o mar e o tempo.</h1>
          <p className="lead">
            {property?.description ??
              'Um flat de alto padrão para viver dias leves, com piscina, conforto e a praia a poucos passos.'}
          </p>
          <a className="button" href="#reserva">
            Ver disponibilidade
          </a>
        </div>
        <div
          className="hero-image"
          role="img"
          aria-label="Área de lazer do flat com piscina"
          style={
            property?.heroImageUrl
              ? { backgroundImage: `url(${property.heroImageUrl})` }
              : undefined
          }
        />
      </section>

      <section className="details">
        <div>
          <p className="eyebrow">A casa</p>
          <h2>Conforto pensado para chegar e ficar.</h2>
        </div>
        <div>
          <p>
            Calendário de disponibilidade, reserva segura e confirmação transparente em um só
            lugar.
          </p>
          <div className="amenities">
            {amenities.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          {property && (
            <dl className="facts">
              <div>
                <dt>Check-in</dt>
                <dd>{property.checkInTime.slice(0, 5)}</dd>
              </div>
              <div>
                <dt>Check-out</dt>
                <dd>{property.checkOutTime.slice(0, 5)}</dd>
              </div>
              <div>
                <dt>Estadia mínima</dt>
                <dd>
                  {property.minNights} {property.minNights === 1 ? 'noite' : 'noites'}
                </dd>
              </div>
              <div>
                <dt>Capacidade</dt>
                <dd>até {property.maxGuests} hóspedes</dd>
              </div>
            </dl>
          )}
        </div>
      </section>

      <section className="booking-section" id="reserva">
        {property ? (
          <BookingWidget property={property} initialUnavailable={unavailable} startDate={from!} />
        ) : (
          <div className="booking-widget">
            <p className="feedback">{error}</p>
            <p>
              Escreva para o anfitrião e reservamos suas datas manualmente enquanto o sistema
              volta.
            </p>
          </div>
        )}
      </section>

      <footer className="site-footer">
        <span>Flat Praia de Carneiros · Tamandaré, PE</span>
        <Link href="/login">Área do hóspede</Link>
      </footer>
    </main>
  );
}
