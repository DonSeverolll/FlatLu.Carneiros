/**
 * Motor de tarifas.
 *
 * Regra do projeto: o front-end não decide preço. Este módulo é puro (nada de
 * banco, nada de rede) e é a única fonte do valor de uma estadia — a mesma
 * função responde ao orçamento mostrado na vitrine e ao valor gravado na
 * reserva, então os dois não podem divergir.
 *
 * Precedência de cada noite:
 *   1. período especial de maior prioridade que cobre a noite
 *   2. tarifa do dia da semana
 *   3. diária de fallback da propriedade
 */

import { addDaysIso, nightsBetween } from './dates';

export type WeekdayRate = {
  weekday: number;
  nightlyCents: number;
  minNightsOnArrival: number | null;
  arrivalAllowed: boolean;
  bookable: boolean;
};

export type RatePeriod = {
  id: string;
  name: string;
  /** Primeira noite coberta. */
  startsOn: string;
  /** Última noite coberta — o check-out é o dia seguinte. */
  endsOn: string;
  nightlyCents: number | null;
  packageCents: number | null;
  minNights: number | null;
  requiresFullPeriod: boolean;
  priority: number;
};

export type QuoteLine =
  | { kind: 'NIGHT'; date: string; amountCents: number; label: string }
  | { kind: 'PACKAGE'; periodId: string; nights: string[]; amountCents: number; label: string };

export type QuoteProblem =
  | { code: 'INVALID_RANGE' }
  | { code: 'RATE_NOT_PUBLISHED'; nights: string[] }
  | { code: 'NIGHT_NOT_BOOKABLE'; nights: string[] }
  | { code: 'ARRIVAL_NOT_ALLOWED'; weekday: number }
  | { code: 'BELOW_MIN_NIGHTS'; minNights: number }
  | { code: 'PERIOD_REQUIRES_FULL_STAY'; periodName: string; startsOn: string; endsOn: string };

export type StayQuote = {
  checkIn: string;
  checkOut: string;
  nights: number;
  lines: QuoteLine[];
  totalCents: number;
  /** Estadia mínima efetiva para este intervalo. */
  minNights: number;
  appliedPeriods: string[];
  problems: QuoteProblem[];
  bookable: boolean;
};

const WEEKDAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function weekdayOf(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABEL[weekday] ?? String(weekday);
}

/** Noites de uma estadia: o dia do check-out não é uma noite. */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const total = nightsBetween(checkIn, checkOut);
  if (total <= 0) return [];
  return Array.from({ length: total }, (_, index) => addDaysIso(checkIn, index));
}

function periodCovering(periods: RatePeriod[], night: string): RatePeriod | undefined {
  let best: RatePeriod | undefined;
  for (const period of periods) {
    if (night < period.startsOn || night > period.endsOn) continue;
    if (!best || period.priority > best.priority) best = period;
  }
  return best;
}

function periodNights(period: RatePeriod): string[] {
  const nights: string[] = [];
  for (let night = period.startsOn; night <= period.endsOn; night = addDaysIso(night, 1)) {
    nights.push(night);
  }
  return nights;
}

export function quoteStay(input: {
  checkIn: string;
  checkOut: string;
  weekdays: WeekdayRate[];
  periods: RatePeriod[];
  /** Usada quando a noite não tem período nem tarifa de dia da semana. */
  fallbackNightlyCents: number;
  propertyMinNights: number;
}): StayQuote {
  const { checkIn, checkOut, weekdays, periods, fallbackNightlyCents, propertyMinNights } = input;
  const nights = nightsOf(checkIn, checkOut);
  const problems: QuoteProblem[] = [];

  if (!nights.length) {
    return {
      checkIn, checkOut, nights: 0, lines: [], totalCents: 0,
      minNights: propertyMinNights, appliedPeriods: [],
      problems: [{ code: 'INVALID_RANGE' }], bookable: false
    };
  }

  const weekdayByIndex = new Map(weekdays.map((rate) => [rate.weekday, rate]));

  // --- chegada -------------------------------------------------------------
  const arrivalWeekday = weekdayOf(checkIn);
  const arrivalRate = weekdayByIndex.get(arrivalWeekday);
  if (arrivalRate && !arrivalRate.arrivalAllowed) {
    problems.push({ code: 'ARRIVAL_NOT_ALLOWED', weekday: arrivalWeekday });
  }

  // --- estadia mínima efetiva ---------------------------------------------
  let minNights = Math.max(1, propertyMinNights);
  if (arrivalRate?.minNightsOnArrival) {
    minNights = Math.max(minNights, arrivalRate.minNightsOnArrival);
  }

  // --- classifica cada noite ----------------------------------------------
  const stayNights = new Set(nights);
  const lines: QuoteLine[] = [];
  const packagesSeen = new Map<string, RatePeriod>();
  const appliedPeriods = new Set<string>();
  const unpublished: string[] = [];
  const unbookable: string[] = [];

  for (const night of nights) {
    const period = periodCovering(periods, night);

    if (period) {
      appliedPeriods.add(period.name);
      if (period.minNights) minNights = Math.max(minNights, period.minNights);

      if (period.packageCents !== null) {
        // O valor do pacote entra uma única vez, depois do laço.
        packagesSeen.set(period.id, period);
        continue;
      }
      lines.push({
        kind: 'NIGHT',
        date: night,
        amountCents: period.nightlyCents ?? 0,
        label: period.name
      });
      continue;
    }

    const rate = weekdayByIndex.get(weekdayOf(night));
    if (rate && !rate.bookable) {
      unbookable.push(night);
      continue;
    }
    const amountCents = rate ? rate.nightlyCents : fallbackNightlyCents;
    if (amountCents <= 0) {
      unpublished.push(night);
      continue;
    }
    lines.push({
      kind: 'NIGHT',
      date: night,
      amountCents,
      label: weekdayLabel(weekdayOf(night))
    });
  }

  // --- pacotes -------------------------------------------------------------
  for (const period of packagesSeen.values()) {
    const covered = periodNights(period);
    const missing = covered.filter((night) => !stayNights.has(night));
    if (period.requiresFullPeriod && missing.length) {
      problems.push({
        code: 'PERIOD_REQUIRES_FULL_STAY',
        periodName: period.name,
        startsOn: period.startsOn,
        endsOn: period.endsOn
      });
      continue;
    }
    lines.push({
      kind: 'PACKAGE',
      periodId: period.id,
      nights: covered.filter((night) => stayNights.has(night)),
      amountCents: period.packageCents ?? 0,
      label: period.name
    });
  }

  if (unpublished.length) problems.push({ code: 'RATE_NOT_PUBLISHED', nights: unpublished });
  if (unbookable.length) problems.push({ code: 'NIGHT_NOT_BOOKABLE', nights: unbookable });
  if (nights.length < minNights) problems.push({ code: 'BELOW_MIN_NIGHTS', minNights });

  // Ordena para o extrato sair em ordem de calendário.
  lines.sort((a, b) => {
    const keyA = a.kind === 'NIGHT' ? a.date : (a.nights[0] ?? '');
    const keyB = b.kind === 'NIGHT' ? b.date : (b.nights[0] ?? '');
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    checkIn,
    checkOut,
    nights: nights.length,
    lines,
    totalCents,
    minNights,
    appliedPeriods: [...appliedPeriods],
    problems,
    bookable: problems.length === 0 && totalCents > 0
  };
}

/** Valor do sinal a partir do total e do percentual configurado. */
export function depositFor(totalCents: number, depositPercentage: string | number): number {
  const percentage = Number(depositPercentage);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('INVALID_DEPOSIT_PERCENTAGE');
  }
  return Math.round((totalCents * percentage) / 100);
}
