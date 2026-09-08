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
  | { kind: 'PACKAGE'; periodId: string; nights: string[]; amountCents: number; label: string }
  /** Um dia sem pernoite: entra e sai na mesma data. */
  | { kind: 'DAY_USE'; date: string; amountCents: number; label: string };

export type QuoteProblem =
  | { code: 'INVALID_RANGE' }
  | { code: 'RATE_NOT_PUBLISHED'; nights: string[] }
  | { code: 'NIGHT_NOT_BOOKABLE'; nights: string[] }
  | { code: 'ARRIVAL_NOT_ALLOWED'; weekday: number }
  | { code: 'BELOW_MIN_NIGHTS'; minNights: number }
  | { code: 'PERIOD_REQUIRES_FULL_STAY'; periodName: string; startsOn: string; endsOn: string }
  | { code: 'DAY_USE_NOT_ALLOWED' };

export type StayQuote = {
  checkIn: string;
  checkOut: string;
  nights: number;
  /**
   * Verdadeiro quando entrada e saída caem na mesma data.
   *
   * `nights` é zero nesses casos, e é justamente por isso que a marca existe:
   * sem ela, todo consumidor do orçamento leria zero noites como intervalo
   * inválido — que foi o comportamento até esta modalidade existir.
   */
  dayUse: boolean;
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

/** Primeira data de uma linha do extrato, qualquer que seja o tipo dela. */
function dataDaLinha(line: QuoteLine): string {
  return line.kind === 'PACKAGE' ? (line.nights[0] ?? '') : line.date;
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
  /** O espaço aceita locação de um dia só, sem pernoite? */
  dayUseAllowed?: boolean;
  /** Tarifa própria do uso diurno. Nula: cobra a diária normal do dia. */
  dayUseCents?: number | null;
}): StayQuote {
  const { checkIn, checkOut, weekdays, periods, fallbackNightlyCents, propertyMinNights } = input;
  const nights = nightsOf(checkIn, checkOut);
  const problems: QuoteProblem[] = [];
  const weekdayByIndex = new Map(weekdays.map((rate) => [rate.weekday, rate]));

  if (!nights.length) {
    // Saída antes da entrada continua sendo erro; saída NO MESMO DIA é uso diurno.
    if (checkOut !== checkIn) {
      return {
        checkIn, checkOut, nights: 0, dayUse: false, lines: [], totalCents: 0,
        minNights: propertyMinNights, appliedPeriods: [],
        problems: [{ code: 'INVALID_RANGE' }], bookable: false
      };
    }
    return quoteDayUse({
      date: checkIn,
      weekdayByIndex,
      periods,
      fallbackNightlyCents,
      allowed: input.dayUseAllowed !== false,
      overrideCents: input.dayUseCents ?? null
    });
  }

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
    const keyA = dataDaLinha(a);
    const keyB = dataDaLinha(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    checkIn,
    checkOut,
    nights: nights.length,
    dayUse: false,
    lines,
    totalCents,
    minNights,
    appliedPeriods: [...appliedPeriods],
    problems,
    bookable: problems.length === 0 && totalCents > 0
  };
}

/**
 * Orça um dia sem pernoite.
 *
 * A estadia mínima não se aplica: ela conta noites, e aqui não há nenhuma.
 * O resto das regras do dia continua valendo — dia da semana fechado para
 * venda, chegada não permitida e pacote que exige o período inteiro recusam
 * o uso diurno do mesmo jeito que recusariam uma diária.
 */
function quoteDayUse(input: {
  date: string;
  weekdayByIndex: Map<number, WeekdayRate>;
  periods: RatePeriod[];
  fallbackNightlyCents: number;
  allowed: boolean;
  overrideCents: number | null;
}): StayQuote {
  const { date, weekdayByIndex, periods, fallbackNightlyCents, overrideCents } = input;
  const base = {
    checkIn: date,
    checkOut: date,
    nights: 0,
    dayUse: true,
    minNights: 0,
    appliedPeriods: [] as string[]
  };

  if (!input.allowed) {
    return { ...base, lines: [], totalCents: 0, problems: [{ code: 'DAY_USE_NOT_ALLOWED' }], bookable: false };
  }

  const problems: QuoteProblem[] = [];
  const weekday = weekdayOf(date);
  const rate = weekdayByIndex.get(weekday);
  const period = periodCovering(periods, date);

  if (rate && !rate.arrivalAllowed) problems.push({ code: 'ARRIVAL_NOT_ALLOWED', weekday });
  if (rate && !rate.bookable && !period) problems.push({ code: 'NIGHT_NOT_BOOKABLE', nights: [date] });

  if (period?.requiresFullPeriod) {
    problems.push({
      code: 'PERIOD_REQUIRES_FULL_STAY',
      periodName: period.name,
      startsOn: period.startsOn,
      endsOn: period.endsOn
    });
  }

  const doDia = period?.nightlyCents ?? rate?.nightlyCents ?? fallbackNightlyCents;
  const amountCents = overrideCents ?? doDia;
  if (amountCents <= 0) problems.push({ code: 'RATE_NOT_PUBLISHED', nights: [date] });

  const label = overrideCents !== null
    ? 'Uso diurno'
    : `Uso diurno · ${period?.name ?? weekdayLabel(weekday)}`;

  return {
    ...base,
    appliedPeriods: period ? [period.name] : [],
    lines: amountCents > 0 ? [{ kind: 'DAY_USE', date, amountCents, label }] : [],
    totalCents: Math.max(0, amountCents),
    problems,
    bookable: problems.length === 0 && amountCents > 0
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
