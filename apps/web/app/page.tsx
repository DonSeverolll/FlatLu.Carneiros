import Link from 'next/link';
import BookingWidget from './BookingWidget';
import { unitCalendar } from '@/server/units';
import type { UnitCalendarDto } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * A vitrine é um Server Component: o calendário das três unidades vem direto da
 * camada de servidor, sem roundtrip HTTP para a própria aplicação. Se o banco
 * estiver indisponível, a página continua no ar em modo degradado — apresentar
 * os espaços não depende da infraestrutura de reservas.
 */
async function loadCalendar(): Promise<{ calendar: UnitCalendarDto | null; error: string | null }> {
  try {
    const calendar = await unitCalendar();
    if (!calendar.units.length) {
      return { calendar: null, error: 'Nenhum espaço publicado no momento.' };
    }
    return { calendar: calendar as UnitCalendarDto, error: null };
  } catch (error) {
    console.error('[showcase]', error);
    return { calendar: null, error: 'Calendário temporariamente indisponível.' };
  }
}

export default async function HomePage() {
  const { calendar, error } = await loadCalendar();

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
      <nav className="nav">
        <strong>APT CARNEIROS · FLAT &amp; CASA</strong>
        <span className="nav-links">
          <a href="#reserva">Consultar datas</a>
          <Link href="/conta">Minha conta</Link>
        </span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Praia de Carneiros e São José da Coroa Grande</p>
          <h1>Seu intervalo entre o mar e o tempo.</h1>
          <p className="lead">
            Três espaços independentes no litoral sul de Pernambuco: o flat na Praia de Carneiros e
            os dois andares da casa em São José da Coroa Grande, cada um com entrada própria.
          </p>
          <a className="button" href="#reserva">
            Ver disponibilidade
          </a>
        </div>
        <div className="hero-image" role="img" aria-label="Área de lazer com piscina" />
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
                    <i className="unit-dot" style={{ background: unit.color }} /> {unit.shortName}
                  </dt>
                  <dd>até {unit.maxGuests} pessoas</dd>
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

      <footer className="site-footer">
        <span>Apt Carneiros · Praia de Carneiros e São José da Coroa Grande — PE</span>
        <Link href="/login">Área do hóspede</Link>
      </footer>
    </main>
  );
}
