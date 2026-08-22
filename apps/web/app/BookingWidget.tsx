'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AvailabilityCalendar from './AvailabilityCalendar';
import { api, messageFor } from '@/lib/api';
import { brl, shortDate } from '@/lib/format';
import type { QuoteResponseDto, ReservationDto, UnitCalendarDto, UnitDto } from '@/lib/types';

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

/**
 * Orquestra a reserva das três unidades: filtro de visualização, escolha do
 * espaço, seleção de datas e orçamento. O preço nunca é calculado aqui — vem
 * de `/quote`, que é a mesma função que a reserva usa para gravar o valor.
 */
export default function BookingWidget({ calendar }: { calendar: UnitCalendarDto }) {
  const router = useRouter();
  const [units, setUnits] = useState<UnitDto[]>(calendar.units);
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(calendar.units.map((unit) => unit.slug))
  );
  const [selectedUnit, setSelectedUnit] = useState(calendar.units[0]?.slug ?? '');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState(2);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [quote, setQuote] = useState<QuoteResponseDto | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const unit = useMemo(
    () => units.find((candidate) => candidate.slug === selectedUnit) ?? units[0],
    [units, selectedUnit]
  );

  const blocked = useMemo(() => new Set(unit?.unavailable ?? []), [unit]);

  // Trocar de espaço invalida as datas: a disponibilidade é outra.
  function selectUnit(slug: string) {
    setSelectedUnit(slug);
    setVisible((current) => new Set(current).add(slug));
    setCheckIn('');
    setCheckOut('');
    setQuote(null);
    setStatus('');
    const next = units.find((candidate) => candidate.slug === slug);
    if (next) setGuests((value) => Math.min(value, next.maxGuests));
  }

  function toggleVisible(slug: string) {
    setVisible((current) => {
      const next = new Set(current);
      // A unidade em reserva não pode sair de vista: as datas selecionadas são dela.
      if (next.has(slug) && slug !== selectedUnit) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function rangeIsFree(fromDay: string, toDay: string): boolean {
    for (let day = fromDay; day < toDay; day = addDays(day, 1)) {
      if (blocked.has(day)) return false;
    }
    return true;
  }

  function pickDay(day: string) {
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

  useEffect(() => {
    if (!unit || !checkIn || !checkOut || nightsBetween(checkIn, checkOut) <= 0) {
      setQuote(null);
      return;
    }
    let active = true;
    setQuoting(true);
    api<QuoteResponseDto>(
      `/api/properties/${unit.slug}/quote?checkIn=${checkIn}&checkOut=${checkOut}`
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
  }, [unit, checkIn, checkOut]);

  async function refreshCalendar() {
    try {
      const data = await api<UnitCalendarDto>('/api/units');
      setUnits(data.units);
    } catch {
      /* mantém o calendário atual; recarregar a página resolve */
    }
  }

  async function reserve() {
    if (!unit) return;
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
          propertyId: unit.slug,
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
      await refreshCalendar();
    } finally {
      setSubmitting(false);
    }
  }

  if (!unit) {
    return (
      <div className="booking-widget">
        <p className="feedback">Nenhum espaço disponível no momento.</p>
      </div>
    );
  }

  const canReserve = Boolean(quote?.quote.bookable && quote.available && termsAccepted);

  return (
    <div className="booking-widget">
      <AvailabilityCalendar
        units={units}
        from={calendar.from}
        to={calendar.to}
        visible={visible}
        onToggleVisible={toggleVisible}
        selectedUnit={unit.slug}
        onSelectUnit={selectUnit}
        checkIn={checkIn}
        checkOut={checkOut}
        onPickDay={pickDay}
      />

      <div className="booking-form" style={{ borderTopColor: unit.color }}>
        <div className="booking-form-head">
          <div>
            <p className="eyebrow" style={{ color: unit.color }}>
              {unit.shortName}
            </p>
            <h2>Sua reserva.</h2>
            {unit.locationUrl && (
              <a className="link" href={unit.locationUrl} rel="noreferrer" target="_blank">
                Ver no mapa
              </a>
            )}
          </div>
        </div>

        <div className="checkout-row">
          <div className="fields">
            <label>
              Entrada
              <input
                type="date"
                value={checkIn}
                min={calendar.from}
                max={calendar.to}
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
                min={checkIn ? addDays(checkIn, 1) : calendar.from}
                onChange={(event) => setCheckOut(event.target.value)}
              />
            </label>
            <label>
              Hóspedes
              <input
                type="number"
                min={1}
                max={unit.maxGuests}
                value={guests}
                onChange={(event) =>
                  setGuests(Math.min(unit.maxGuests, Math.max(1, Number(event.target.value))))
                }
              />
            </label>
          </div>

          <div className="quote">
            {!checkIn || !checkOut ? (
              <>
                <span>Selecione entrada e saída</span>
                <strong>
                  {unit.rates?.fromCents
                    ? `a partir de ${brl(unit.rates.fromCents / 100)}`
                    : 'Tarifa sob consulta'}
                </strong>
                <small>O valor exato depende dos dias escolhidos.</small>
              </>
            ) : quoting ? (
              <span>Calculando...</span>
            ) : quote?.quote.bookable && quote.available ? (
              <>
                <span>
                  {quote.quote.nights} {quote.quote.nights === 1 ? 'noite' : 'noites'}
                </span>
                <strong>{brl(quote.quote.totalAmount)}</strong>
                <small>
                  Sinal de {Number(unit.depositPercentage).toFixed(0)}%:{' '}
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
              Termos de Locação ({unit.termsVersion})
            </button>
            .
          </span>
        </label>
        {showTerms && <pre className="terms-content">{unit.termsContent}</pre>}

        <button
          className="button"
          type="button"
          onClick={() => void reserve()}
          disabled={submitting || !canReserve}
          style={canReserve ? { background: unit.color } : undefined}
        >
          {submitting ? 'Enviando...' : `Reservar ${unit.shortName}`}
        </button>
        <p className="hint">
          A data fica reservada por {unit.holdMinutes} minutos até o pagamento do sinal.
        </p>
        {status && <p className="feedback">{status}</p>}
      </div>
    </div>
  );
}

function describeProblems(response: QuoteResponseDto): string {
  if (!response.available) return 'Estas datas já estão ocupadas neste espaço.';
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
