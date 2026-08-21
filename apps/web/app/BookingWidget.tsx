'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/api';
import { brl, longDate, shortDate } from '@/lib/format';
import type {
  AvailabilityDto,
  PublicPropertyDto,
  QuoteResponseDto,
  ReservationDto
} from '@/lib/types';

type Props = {
  property: PublicPropertyDto;
  initialUnavailable: string[];
  startDate: string;
};

function addDays(iso: string, amount: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const toUtc = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(checkOut) - toUtc(checkIn)) / 86_400_000);
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export default function BookingWidget({ property, initialUnavailable, startDate }: Props) {
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(() => new Set(initialUnavailable));
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState(2);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [quote, setQuote] = useState<QuoteResponseDto | null>(null);
  const [quoting, setQuoting] = useState(false);

  const days = useMemo(() => {
    const horizon = Math.min(property.bookingHorizonDays, 180);
    return Array.from({ length: horizon }, (_, index) => addDays(startDate, index));
  }, [startDate, property.bookingHorizonDays]);

  /** Tarifa de cada dia do calendário, só para o rótulo — o total vem da API. */
  const rateByWeekday = useMemo(() => {
    const map = new Map<number, number>();
    for (const rate of property.rates?.weekdays ?? []) map.set(rate.weekday, rate.nightlyCents);
    return map;
  }, [property.rates]);

  /**
   * O preço é sempre do servidor. Calcular no navegador significaria duplicar
   * as regras de dia da semana, período especial e pacote fechado — e divergir
   * do valor que a reserva vai gravar.
   */
  useEffect(() => {
    if (!checkIn || !checkOut || nightsBetween(checkIn, checkOut) <= 0) {
      setQuote(null);
      return;
    }
    let active = true;
    setQuoting(true);
    api<QuoteResponseDto>(
      `/api/properties/${property.slug}/quote?checkIn=${checkIn}&checkOut=${checkOut}`
    )
      .then((data) => {
        if (active) setQuote(data);
      })
      .catch(() => {
        if (active) setQuote(null);
      })
      .finally(() => {
        if (active) setQuoting(false);
      });
    return () => {
      active = false;
    };
  }, [checkIn, checkOut, property.slug]);

  function rangeIsFree(from: string, to: string): boolean {
    for (let day = from; day < to; day = addDays(day, 1)) {
      if (unavailable.has(day)) return false;
    }
    return true;
  }

  function selectDay(day: string) {
    setStatus('');
    if (!checkIn || checkOut || day <= checkIn) {
      setCheckIn(day);
      setCheckOut('');
      return;
    }
    if (!rangeIsFree(checkIn, day)) {
      setStatus('Há noites ocupadas nesse intervalo. Escolha outro período.');
      return;
    }
    setCheckOut(day);
  }

  async function refreshAvailability() {
    try {
      const data = await api<AvailabilityDto>(`/api/properties/${property.slug}/availability`);
      setUnavailable(new Set(data.unavailable));
    } catch {
      /* mantém o calendário atual: recarregar a página resolve */
    }
  }

  async function reserve() {
    if (!checkIn || !checkOut) {
      setStatus('Escolha a data de entrada e a de saída.');
      return;
    }
    if (!termsAccepted) {
      setStatus('É necessário aceitar os Termos de Locação.');
      return;
    }
    setSubmitting(true);
    setStatus('Confirmando disponibilidade...');
    try {
      const { reservation } = await api<{ reservation: ReservationDto }>('/api/reservations', {
        method: 'POST',
        body: {
          propertyId: property.slug,
          checkIn,
          checkOut,
          guestCount: guests,
          termsAccepted: true,
          idempotencyKey: crypto.randomUUID()
        }
      });
      router.push(`/reserva/${reservation.id}`);
    } catch (error) {
      setStatus(messageFor(error));
      await refreshAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  const fromLabel = property.rates?.fromCents ? brl(property.rates.fromCents / 100) : null;
  const canReserve = Boolean(quote?.quote.bookable && quote.available && termsAccepted);

  return (
    <div className="booking-widget">
      <div className="calendar-head">
        <div>
          <p className="eyebrow">Disponibilidade</p>
          <h2>Escolha seus dias.</h2>
        </div>
        <span>
          {fromLabel ? `A partir de ${fromLabel} a noite · ` : ''}
          próximos {days.length} dias
        </span>
      </div>

      {property.rates?.periods.length ? (
        <div className="amenities periods">
          {property.rates.periods.map((period) => (
            <span key={`${period.name}-${period.startsOn}`}>
              {period.name}: {shortDate(period.startsOn)} a {shortDate(period.endsOn)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="date-grid">
        {days.map((day) => {
          const blocked = unavailable.has(day);
          const isEdge = day === checkIn || day === checkOut;
          const inRange = Boolean(checkIn && checkOut && day > checkIn && day < checkOut);
          const [, , dayNumber] = day.split('-');
          const weekdayIndex = new Date(`${day}T12:00:00Z`).getUTCDay();
          const cents = rateByWeekday.get(weekdayIndex);
          return (
            <button
              className={`date${isEdge ? ' selected' : ''}${inRange ? ' in-range' : ''}`}
              disabled={blocked}
              key={day}
              onClick={() => selectDay(day)}
              type="button"
              aria-label={`${longDate(day)}${blocked ? ' — indisponível' : ''}`}
            >
              <small>{WEEKDAYS[weekdayIndex]}</small>
              <strong>{Number(dayNumber)}</strong>
              {cents ? <em>{Math.round(cents / 100)}</em> : null}
            </button>
          );
        })}
      </div>

      <div className="checkout-row">
        <div className="fields">
          <label>
            Entrada
            <input
              type="date"
              value={checkIn}
              min={startDate}
              onChange={(event) => {
                setCheckIn(event.target.value);
                setCheckOut('');
              }}
            />
          </label>
          <label>
            Saída
            <input
              type="date"
              value={checkOut}
              min={checkIn ? addDays(checkIn, 1) : startDate}
              onChange={(event) => setCheckOut(event.target.value)}
            />
          </label>
          <label>
            Hóspedes
            <input
              type="number"
              min={1}
              max={property.maxGuests}
              value={guests}
              onChange={(event) =>
                setGuests(Math.min(property.maxGuests, Math.max(1, Number(event.target.value))))
              }
            />
          </label>
        </div>

        <div className="quote">
          {!checkIn || !checkOut ? (
            <>
              <span>Selecione entrada e saída</span>
              <strong>{fromLabel ?? 'Tarifa sob consulta'}</strong>
              <small>
                {property.ratePublished
                  ? 'O valor exato depende dos dias escolhidos.'
                  : 'Envie um pedido e o anfitrião confirma o valor.'}
              </small>
            </>
          ) : quoting ? (
            <span>Calculando...</span>
          ) : quote?.quote.bookable ? (
            <>
              <span>
                {quote.quote.nights} {quote.quote.nights === 1 ? 'noite' : 'noites'}
                {!quote.available && ' — datas ocupadas'}
              </span>
              <strong>{brl(quote.quote.totalAmount)}</strong>
              <small>
                Sinal de {Number(property.depositPercentage).toFixed(0)}%:{' '}
                {brl(quote.quote.depositAmount)}
              </small>
            </>
          ) : (
            <>
              <span>{quote?.quote.nights ?? 0} noite(s)</span>
              <strong>Indisponível</strong>
              <small>{quote ? describeProblems(quote) : 'Não foi possível orçar.'}</small>
            </>
          )}
        </div>
      </div>

      {/* Extrato aberto: o hóspede vê de onde vem cada valor. */}
      {quote?.quote.bookable && quote.quote.lines.length > 1 && (
        <table className="rate-breakdown">
          <tbody>
            {quote.quote.lines.map((line, index) => (
              <tr key={index}>
                <td>
                  {line.kind === 'NIGHT'
                    ? `${shortDate(line.date)} · ${line.label}`
                    : `${line.label} · ${line.nights.length} noites`}
                </td>
                <td>{brl(line.amountCents / 100)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td>{brl(quote.quote.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <label className="terms">
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(event) => setTermsAccepted(event.target.checked)}
        />
        <span>
          Aceito os{' '}
          <button className="link" type="button" onClick={() => setShowTerms((value) => !value)}>
            Termos de Locação ({property.termsVersion})
          </button>
          .
        </span>
      </label>
      {showTerms && <pre className="terms-content">{property.termsContent}</pre>}

      <button
        className="button"
        type="button"
        onClick={() => void reserve()}
        disabled={submitting || !canReserve}
      >
        {submitting ? 'Enviando...' : 'Solicitar reserva'}
      </button>
      <p className="hint">
        A data fica reservada por {property.holdMinutes} minutos até o pagamento do sinal.
      </p>
      {status && <p className="feedback">{status}</p>}
    </div>
  );
}

/** Explica em português por que o intervalo escolhido não fecha. */
function describeProblems(response: QuoteResponseDto): string {
  if (!response.available) return 'Estas datas já estão ocupadas.';
  const problem = response.quote.problems[0];
  if (!problem) return 'Escolha outro intervalo.';
  switch (problem.code) {
    case 'BELOW_MIN_NIGHTS':
      return `Estadia mínima de ${problem.minNights} noites para essa data de entrada.`;
    case 'NIGHT_NOT_BOOKABLE':
      return 'Uma das noites escolhidas não é alugada avulsa.';
    case 'ARRIVAL_NOT_ALLOWED':
      return 'Não há check-in nesse dia da semana.';
    case 'PERIOD_REQUIRES_FULL_STAY':
      return `${problem.periodName} é pacote fechado: a estadia precisa cobrir o período inteiro.`;
    case 'RATE_NOT_PUBLISHED':
      return 'A tarifa dessas datas ainda não foi publicada.';
    default:
      return 'Escolha outro intervalo.';
  }
}
