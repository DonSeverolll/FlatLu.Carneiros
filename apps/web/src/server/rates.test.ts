import { describe, expect, it } from 'vitest';
import {
  type RatePeriod,
  type WeekdayRate,
  depositFor,
  nightsOf,
  quoteStay,
  weekdayOf
} from './rates';

/**
 * A tabela real do flat, em centavos:
 *   segunda a quinta  R$   300
 *   sexta             R$   400
 *   sábado            R$ 1.000  (fim de semana, mínimo de 1 noite sáb→dom)
 *   domingo           R$   300
 */
const WEEKDAYS: WeekdayRate[] = [
  { weekday: 0, nightlyCents: 30_000, minNightsOnArrival: null, arrivalAllowed: true, bookable: true },
  { weekday: 1, nightlyCents: 30_000, minNightsOnArrival: null, arrivalAllowed: true, bookable: true },
  { weekday: 2, nightlyCents: 30_000, minNightsOnArrival: null, arrivalAllowed: true, bookable: true },
  { weekday: 3, nightlyCents: 30_000, minNightsOnArrival: null, arrivalAllowed: true, bookable: true },
  { weekday: 4, nightlyCents: 30_000, minNightsOnArrival: null, arrivalAllowed: true, bookable: true },
  { weekday: 5, nightlyCents: 40_000, minNightsOnArrival: null, arrivalAllowed: true, bookable: true },
  { weekday: 6, nightlyCents: 100_000, minNightsOnArrival: 1, arrivalAllowed: true, bookable: true }
];

const base = {
  weekdays: WEEKDAYS,
  periods: [] as RatePeriod[],
  fallbackNightlyCents: 0,
  propertyMinNights: 1
};

// Referências de calendário: 2026-09-14 é uma segunda-feira.
const MONDAY = '2026-09-14';
const FRIDAY = '2026-09-18';
const SATURDAY = '2026-09-19';
const SUNDAY = '2026-09-20';

describe('weekdayOf', () => {
  it('usa a convenção do PostgreSQL (0 = domingo)', () => {
    expect(weekdayOf(SUNDAY)).toBe(0);
    expect(weekdayOf(MONDAY)).toBe(1);
    expect(weekdayOf(FRIDAY)).toBe(5);
    expect(weekdayOf(SATURDAY)).toBe(6);
  });
});

describe('nightsOf', () => {
  it('não conta o dia do check-out como noite', () => {
    expect(nightsOf(MONDAY, '2026-09-17')).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
    expect(nightsOf(MONDAY, MONDAY)).toEqual([]);
  });
});

describe('tarifa por dia da semana', () => {
  it('segunda a quinta: 3 noites x 300 = 900', () => {
    const quote = quoteStay({ ...base, checkIn: MONDAY, checkOut: '2026-09-17' });
    expect(quote.totalCents).toBe(90_000);
    expect(quote.nights).toBe(3);
    expect(quote.bookable).toBe(true);
  });

  it('quarta a sábado cobra a sexta mais caro: 300 + 300 + 400 = 1000', () => {
    const quote = quoteStay({ ...base, checkIn: '2026-09-16', checkOut: SATURDAY });
    expect(quote.totalCents).toBe(100_000);
    expect(quote.lines.map((line) => line.amountCents)).toEqual([30_000, 30_000, 40_000]);
  });

  it('sábado para domingo é o fim de semana: 1000', () => {
    const quote = quoteStay({ ...base, checkIn: SATURDAY, checkOut: SUNDAY });
    expect(quote.totalCents).toBe(100_000);
    expect(quote.nights).toBe(1);
    expect(quote.bookable).toBe(true);
  });

  it('sexta a domingo soma sexta e sábado: 400 + 1000 = 1400', () => {
    const quote = quoteStay({ ...base, checkIn: FRIDAY, checkOut: SUNDAY });
    expect(quote.totalCents).toBe(140_000);
  });

  it('cada noite aparece no extrato com o rótulo do dia', () => {
    const quote = quoteStay({ ...base, checkIn: FRIDAY, checkOut: SUNDAY });
    expect(quote.lines).toEqual([
      { kind: 'NIGHT', date: FRIDAY, amountCents: 40_000, label: 'Sexta' },
      { kind: 'NIGHT', date: SATURDAY, amountCents: 100_000, label: 'Sábado' }
    ]);
  });
});

describe('regras de estadia', () => {
  it('estadia mínima do dia de chegada é respeitada', () => {
    const weekdays = WEEKDAYS.map((rate) =>
      rate.weekday === 6 ? { ...rate, minNightsOnArrival: 2 } : rate
    );
    const quote = quoteStay({ ...base, weekdays, checkIn: SATURDAY, checkOut: SUNDAY });
    expect(quote.problems).toEqual([{ code: 'BELOW_MIN_NIGHTS', minNights: 2 }]);
    expect(quote.bookable).toBe(false);
    expect(quote.minNights).toBe(2);
  });

  it('dia bloqueado para chegada é recusado', () => {
    const weekdays = WEEKDAYS.map((rate) =>
      rate.weekday === 0 ? { ...rate, arrivalAllowed: false } : rate
    );
    const quote = quoteStay({ ...base, weekdays, checkIn: SUNDAY, checkOut: '2026-09-22' });
    expect(quote.problems).toContainEqual({ code: 'ARRIVAL_NOT_ALLOWED', weekday: 0 });
  });

  it('noite não comercializada é recusada em vez de cobrada de graça', () => {
    const weekdays = WEEKDAYS.map((rate) =>
      rate.weekday === 0 ? { ...rate, bookable: false } : rate
    );
    const quote = quoteStay({ ...base, weekdays, checkIn: SATURDAY, checkOut: '2026-09-21' });
    expect(quote.problems).toContainEqual({ code: 'NIGHT_NOT_BOOKABLE', nights: [SUNDAY] });
    expect(quote.bookable).toBe(false);
  });

  it('o mínimo mais restritivo entre imóvel, dia e período vence', () => {
    const periods: RatePeriod[] = [{
      id: 'p1', name: 'Alta estação', startsOn: '2026-09-01', endsOn: '2026-09-30',
      nightlyCents: 50_000, packageCents: null, minNights: 5, requiresFullPeriod: false, priority: 100
    }];
    const quote = quoteStay({ ...base, propertyMinNights: 2, periods, checkIn: MONDAY, checkOut: '2026-09-17' });
    expect(quote.minNights).toBe(5);
    expect(quote.problems).toContainEqual({ code: 'BELOW_MIN_NIGHTS', minNights: 5 });
  });
});

describe('períodos especiais', () => {
  it('período por noite substitui a tarifa do dia da semana', () => {
    const periods: RatePeriod[] = [{
      id: 'natal', name: 'Natal', startsOn: '2026-12-24', endsOn: '2026-12-25',
      nightlyCents: 150_000, packageCents: null, minNights: null, requiresFullPeriod: false, priority: 100
    }];
    // 24 e 25 de dezembro de 2026 caem em quinta e sexta (300 e 400 na tabela).
    const quote = quoteStay({ ...base, periods, checkIn: '2026-12-24', checkOut: '2026-12-26' });
    expect(quote.totalCents).toBe(300_000);
    expect(quote.appliedPeriods).toEqual(['Natal']);
  });

  it('noites fora do período voltam à tarifa do dia', () => {
    const periods: RatePeriod[] = [{
      id: 'natal', name: 'Natal', startsOn: '2026-12-24', endsOn: '2026-12-25',
      nightlyCents: 150_000, packageCents: null, minNights: null, requiresFullPeriod: false, priority: 100
    }];
    // 26/12/2026 é sábado: 1000.
    const quote = quoteStay({ ...base, periods, checkIn: '2026-12-24', checkOut: '2026-12-27' });
    expect(quote.totalCents).toBe(150_000 + 150_000 + 100_000);
  });

  it('pacote é cobrado uma única vez, não por noite', () => {
    const periods: RatePeriod[] = [{
      id: 'rev', name: 'Réveillon', startsOn: '2026-12-30', endsOn: '2027-01-01',
      nightlyCents: null, packageCents: 250_000, minNights: null, requiresFullPeriod: true, priority: 200
    }];
    const quote = quoteStay({ ...base, periods, checkIn: '2026-12-30', checkOut: '2027-01-02' });
    expect(quote.totalCents).toBe(250_000);
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]).toMatchObject({ kind: 'PACKAGE', amountCents: 250_000, label: 'Réveillon' });
    expect(quote.bookable).toBe(true);
  });

  it('pacote incompleto é recusado em vez de rateado', () => {
    const periods: RatePeriod[] = [{
      id: 'rev', name: 'Réveillon', startsOn: '2026-12-30', endsOn: '2027-01-01',
      nightlyCents: null, packageCents: 250_000, minNights: null, requiresFullPeriod: true, priority: 200
    }];
    const quote = quoteStay({ ...base, periods, checkIn: '2026-12-31', checkOut: '2027-01-02' });
    expect(quote.problems).toContainEqual({
      code: 'PERIOD_REQUIRES_FULL_STAY', periodName: 'Réveillon',
      startsOn: '2026-12-30', endsOn: '2027-01-01'
    });
    expect(quote.bookable).toBe(false);
  });

  it('pacote somado a noites comuns fecha o total', () => {
    const periods: RatePeriod[] = [{
      id: 'rev', name: 'Réveillon', startsOn: '2026-12-30', endsOn: '2027-01-01',
      nightlyCents: null, packageCents: 250_000, minNights: null, requiresFullPeriod: true, priority: 200
    }];
    // 02/01/2027 é sábado (1000).
    const quote = quoteStay({ ...base, periods, checkIn: '2026-12-30', checkOut: '2027-01-03' });
    expect(quote.totalCents).toBe(250_000 + 100_000);
    expect(quote.lines).toHaveLength(2);
  });

  it('prioridade decide quando dois períodos cobrem a mesma noite', () => {
    const periods: RatePeriod[] = [
      { id: 'alta', name: 'Alta estação', startsOn: '2026-12-20', endsOn: '2027-01-10',
        nightlyCents: 80_000, packageCents: null, minNights: null, requiresFullPeriod: false, priority: 100 },
      { id: 'rev', name: 'Réveillon', startsOn: '2026-12-31', endsOn: '2026-12-31',
        nightlyCents: 250_000, packageCents: null, minNights: null, requiresFullPeriod: false, priority: 200 }
    ];
    const quote = quoteStay({ ...base, periods, checkIn: '2026-12-30', checkOut: '2027-01-01' });
    expect(quote.totalCents).toBe(80_000 + 250_000);
    expect(quote.appliedPeriods.sort()).toEqual(['Alta estação', 'Réveillon']);
  });

  it('feriado prolongado como pacote exige o bloco inteiro', () => {
    const periods: RatePeriod[] = [{
      id: 'carnaval', name: 'Carnaval', startsOn: '2027-02-06', endsOn: '2027-02-09',
      nightlyCents: null, packageCents: 150_000, minNights: null, requiresFullPeriod: true, priority: 150
    }];
    const ok = quoteStay({ ...base, periods, checkIn: '2027-02-06', checkOut: '2027-02-10' });
    expect(ok.totalCents).toBe(150_000);
    expect(ok.bookable).toBe(true);

    const partial = quoteStay({ ...base, periods, checkIn: '2027-02-07', checkOut: '2027-02-09' });
    expect(partial.bookable).toBe(false);
  });
});

describe('tarifa não publicada', () => {
  it('sem tarifa de dia e sem fallback, a noite é recusada', () => {
    const quote = quoteStay({ ...base, weekdays: [], checkIn: MONDAY, checkOut: '2026-09-16' });
    expect(quote.problems).toContainEqual({
      code: 'RATE_NOT_PUBLISHED', nights: ['2026-09-14', '2026-09-15']
    });
    expect(quote.bookable).toBe(false);
    expect(quote.totalCents).toBe(0);
  });

  it('fallback da propriedade cobre dia sem tarifa configurada', () => {
    const quote = quoteStay({
      ...base, weekdays: [], fallbackNightlyCents: 65_000, checkIn: MONDAY, checkOut: '2026-09-16'
    });
    expect(quote.totalCents).toBe(130_000);
    expect(quote.bookable).toBe(true);
  });

  it('intervalo invertido é recusado antes de qualquer cálculo', () => {
    const quote = quoteStay({ ...base, checkIn: SUNDAY, checkOut: FRIDAY });
    expect(quote.problems).toEqual([{ code: 'INVALID_RANGE' }]);
    expect(quote.bookable).toBe(false);
  });
});

describe('depositFor', () => {
  it('calcula o sinal em centavos inteiros', () => {
    expect(depositFor(140_000, '50.00')).toBe(70_000);
    expect(depositFor(100_001, 50)).toBe(50_001);
    expect(depositFor(0, 50)).toBe(0);
  });

  it('recusa percentual impossível', () => {
    expect(() => depositFor(1000, 101)).toThrow();
    expect(() => depositFor(1000, -1)).toThrow();
  });
});

/**
 * Uso diurno: entrada e saída na mesma data, sem pernoite.
 *
 * O caso que motiva a modalidade é o hóspede que quer o espaço das 09:00 às
 * 16:00 de um dia e devolvê-lo no mesmo dia, deixando as outras datas livres.
 */
describe('quoteStay — uso diurno', () => {
  it('mesma data cobra a diária daquele dia', () => {
    const quote = quoteStay({ ...base, checkIn: MONDAY, checkOut: MONDAY });
    expect(quote.dayUse).toBe(true);
    expect(quote.nights).toBe(0);
    expect(quote.totalCents).toBe(30_000);
    expect(quote.bookable).toBe(true);
    expect(quote.problems).toEqual([]);
  });

  it('respeita a tarifa do dia da semana, não uma diária média', () => {
    expect(quoteStay({ ...base, checkIn: SATURDAY, checkOut: SATURDAY }).totalCents).toBe(100_000);
    expect(quoteStay({ ...base, checkIn: FRIDAY, checkOut: FRIDAY }).totalCents).toBe(40_000);
  });

  it('a estadia mínima não se aplica — ela conta noites, e aqui não há nenhuma', () => {
    const quote = quoteStay({
      ...base,
      propertyMinNights: 3,
      checkIn: MONDAY,
      checkOut: MONDAY
    });
    expect(quote.bookable).toBe(true);
    expect(quote.problems).toEqual([]);
  });

  it('tarifa própria de uso diurno prevalece sobre a diária', () => {
    const quote = quoteStay({
      ...base,
      checkIn: SATURDAY,
      checkOut: SATURDAY,
      dayUseCents: 25_000
    });
    expect(quote.totalCents).toBe(25_000);
    expect(quote.lines[0]?.label).toBe('Uso diurno');
  });

  it('recusa quando o espaço não aceita a modalidade', () => {
    const quote = quoteStay({
      ...base,
      checkIn: MONDAY,
      checkOut: MONDAY,
      dayUseAllowed: false
    });
    expect(quote.bookable).toBe(false);
    expect(quote.problems).toEqual([{ code: 'DAY_USE_NOT_ALLOWED' }]);
  });

  it('saída ANTES da entrada continua sendo intervalo inválido', () => {
    const quote = quoteStay({ ...base, checkIn: SUNDAY, checkOut: MONDAY });
    expect(quote.dayUse).toBe(false);
    expect(quote.problems).toEqual([{ code: 'INVALID_RANGE' }]);
  });

  it('dia fechado para venda recusa o uso diurno', () => {
    const fechado: WeekdayRate[] = WEEKDAYS.map((w) =>
      w.weekday === 1 ? { ...w, bookable: false } : w
    );
    const quote = quoteStay({ ...base, weekdays: fechado, checkIn: MONDAY, checkOut: MONDAY });
    expect(quote.problems).toContainEqual({ code: 'NIGHT_NOT_BOOKABLE', nights: [MONDAY] });
  });

  it('dia sem chegada permitida recusa o uso diurno', () => {
    const semChegada: WeekdayRate[] = WEEKDAYS.map((w) =>
      w.weekday === 1 ? { ...w, arrivalAllowed: false } : w
    );
    const quote = quoteStay({ ...base, weekdays: semChegada, checkIn: MONDAY, checkOut: MONDAY });
    expect(quote.problems).toContainEqual({ code: 'ARRIVAL_NOT_ALLOWED', weekday: 1 });
  });

  it('pacote que exige o período inteiro não é fatiado em um dia', () => {
    const reveillon: RatePeriod = {
      id: 'p1',
      name: 'Réveillon',
      startsOn: '2026-12-31',
      endsOn: '2027-01-03',
      nightlyCents: null,
      packageCents: 250_000,
      minNights: null,
      requiresFullPeriod: true,
      priority: 100
    };
    const quote = quoteStay({
      ...base,
      periods: [reveillon],
      checkIn: '2027-01-01',
      checkOut: '2027-01-01'
    });
    expect(quote.bookable).toBe(false);
    expect(quote.problems).toContainEqual({
      code: 'PERIOD_REQUIRES_FULL_STAY',
      periodName: 'Réveillon',
      startsOn: '2026-12-31',
      endsOn: '2027-01-03'
    });
  });

  it('período com diária própria vale também no uso diurno', () => {
    const feriado: RatePeriod = {
      id: 'p2',
      name: 'Feriado',
      startsOn: MONDAY,
      endsOn: MONDAY,
      nightlyCents: 55_000,
      packageCents: null,
      minNights: null,
      requiresFullPeriod: false,
      priority: 50
    };
    const quote = quoteStay({ ...base, periods: [feriado], checkIn: MONDAY, checkOut: MONDAY });
    expect(quote.totalCents).toBe(55_000);
    expect(quote.appliedPeriods).toEqual(['Feriado']);
  });

  it('sem tarifa publicada não é vendável', () => {
    const quote = quoteStay({
      ...base,
      weekdays: [],
      fallbackNightlyCents: 0,
      checkIn: MONDAY,
      checkOut: MONDAY
    });
    expect(quote.bookable).toBe(false);
    expect(quote.problems).toContainEqual({ code: 'RATE_NOT_PUBLISHED', nights: [MONDAY] });
  });
});
