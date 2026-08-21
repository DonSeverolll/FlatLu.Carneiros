'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/api';
import { brl, longDate } from '@/lib/format';
import type { AvailabilityDto, PublicPropertyDto, ReservationDto } from '@/lib/types';

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

  const days = useMemo(() => {
    const horizon = Math.min(property.bookingHorizonDays, 180);
    return Array.from({ length: horizon }, (_, index) => addDays(startDate, index));
  }, [startDate, property.bookingHorizonDays]);

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;

  /**
   * Preço só aparece quando o anfitrião publicou a diária. Enquanto
   * `nightly_rate` for zero, a vitrine diz "sob consulta" em vez de anunciar
   * R$ 0,00 — e a API recusa a reserva pelo mesmo motivo.
   */
  const totalCents = property.ratePublished
    ? Math.round(Number(property.nightlyRate) * 100) * nights
    : 0;
  const depositCents = Math.round((totalCents * Number(property.depositPercentage)) / 100);

  /** Toda noite do intervalo precisa estar livre, não só as pontas. */
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
    const selectedNights = nightsBetween(checkIn, day);
    if (selectedNights < property.minNights) {
      setStatus(`A estadia mínima é de ${property.minNights} noites.`);
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
    if (!checkIn || !checkOut || nights <= 0) {
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
      // 409 significa que outra pessoa fechou essas datas agora: recarrega.
      await refreshAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="booking-widget">
      <div className="calendar-head">
        <div>
          <p className="eyebrow">Disponibilidade</p>
          <h2>Escolha seus dias.</h2>
        </div>
        <span>Próximos {days.length} dias</span>
      </div>

      <div className="date-grid">
        {days.map((day) => {
          const blocked = unavailable.has(day);
          const isEdge = day === checkIn || day === checkOut;
          const inRange = Boolean(checkIn && checkOut && day > checkIn && day < checkOut);
          const [, , dayNumber] = day.split('-');
          const weekday = WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
          return (
            <button
              className={`date${isEdge ? ' selected' : ''}${inRange ? ' in-range' : ''}`}
              disabled={blocked}
              key={day}
              onClick={() => selectDay(day)}
              type="button"
              aria-label={`${longDate(day)}${blocked ? ' — indisponível' : ''}`}
            >
              <small>{weekday}</small>
              <strong>{Number(dayNumber)}</strong>
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
              min={checkIn ? addDays(checkIn, property.minNights) : startDate}
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
          {property.ratePublished ? (
            <>
              <span>
                {nights} {nights === 1 ? 'noite' : 'noites'}
                {nights > 0 && ` × ${brl(property.nightlyRate)}`}
              </span>
              <strong>{brl(totalCents / 100)}</strong>
              <small>
                Sinal de {Number(property.depositPercentage).toFixed(0)}%:{' '}
                {brl(depositCents / 100)}
              </small>
            </>
          ) : (
            <>
              <span>{nights > 0 ? `${nights} noite(s)` : 'Selecione as datas'}</span>
              <strong>Tarifa sob consulta</strong>
              <small>Envie um pedido e o anfitrião confirma o valor.</small>
            </>
          )}
        </div>
      </div>

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

      <button className="button" type="button" onClick={() => void reserve()} disabled={submitting}>
        {submitting ? 'Enviando...' : 'Solicitar reserva'}
      </button>
      <p className="hint">
        A data fica reservada por {property.holdMinutes} minutos até o pagamento do sinal.
      </p>
      {status && <p className="feedback">{status}</p>}
    </div>
  );
}
