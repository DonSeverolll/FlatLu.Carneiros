import type { PoolClient } from 'pg';
import { AppError, badRequest, conflict } from './errors';
import { loadRateCalendar } from './rateStore';
import { type StayQuote, depositFor, quoteStay, weekdayLabel } from './rates';
import type { PropertyRow } from './property';

/**
 * Ponte entre o motor puro de tarifas e o banco. Existe uma única função para
 * orçar, usada tanto pelo endpoint público quanto pela criação da reserva —
 * é o que garante que o valor mostrado e o valor cobrado sejam o mesmo.
 */
export async function quoteForProperty(
  property: PropertyRow,
  checkIn: string,
  checkOut: string,
  client?: PoolClient
): Promise<StayQuote> {
  const calendar = await loadRateCalendar(property.id, client);
  return quoteStay({
    checkIn,
    checkOut,
    weekdays: calendar.weekdays,
    periods: calendar.periods,
    fallbackNightlyCents: Math.round(Number(property.nightly_rate) * 100),
    propertyMinNights: property.min_nights
  });
}

/** Traduz o primeiro impedimento em erro HTTP com o detalhe que o front usa. */
export function assertBookable(quote: StayQuote): void {
  const problem = quote.problems[0];
  if (!problem) {
    if (quote.totalCents <= 0) throw conflict('RATE_NOT_PUBLISHED');
    return;
  }

  switch (problem.code) {
    case 'INVALID_RANGE':
      throw badRequest('CHECKOUT_BEFORE_CHECKIN');
    case 'RATE_NOT_PUBLISHED':
      throw new AppError(409, 'RATE_NOT_PUBLISHED', { nights: problem.nights });
    case 'NIGHT_NOT_BOOKABLE':
      throw new AppError(409, 'NIGHTS_NOT_BOOKABLE', { nights: problem.nights });
    case 'ARRIVAL_NOT_ALLOWED':
      throw new AppError(400, 'ARRIVAL_NOT_ALLOWED', {
        weekday: problem.weekday,
        weekdayLabel: weekdayLabel(problem.weekday)
      });
    case 'BELOW_MIN_NIGHTS':
      throw badRequest('BELOW_MIN_NIGHTS', { minNights: problem.minNights });
    case 'PERIOD_REQUIRES_FULL_STAY':
      throw new AppError(409, 'PERIOD_REQUIRES_FULL_STAY', {
        periodName: problem.periodName,
        startsOn: problem.startsOn,
        endsOn: problem.endsOn
      });
  }
}

/** Formato devolvido ao navegador: valores em centavos e em reais. */
export function serializeQuote(quote: StayQuote, depositPercentage: string) {
  const depositCents = depositFor(quote.totalCents, depositPercentage);
  return {
    checkIn: quote.checkIn,
    checkOut: quote.checkOut,
    nights: quote.nights,
    minNights: quote.minNights,
    lines: quote.lines.map((line) =>
      line.kind === 'NIGHT'
        ? { kind: line.kind, date: line.date, label: line.label, amountCents: line.amountCents }
        : {
            kind: line.kind,
            label: line.label,
            nights: line.nights,
            amountCents: line.amountCents
          }
    ),
    appliedPeriods: quote.appliedPeriods,
    totalCents: quote.totalCents,
    depositCents,
    balanceCents: quote.totalCents - depositCents,
    totalAmount: (quote.totalCents / 100).toFixed(2),
    depositAmount: (depositCents / 100).toFixed(2),
    bookable: quote.bookable,
    problems: quote.problems
  };
}
