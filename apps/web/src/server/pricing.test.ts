import { describe, expect, it } from 'vitest';
import { centsToNumeric, formatBRL, quote } from './pricing';

describe('quote', () => {
  it('multiplica em centavos inteiros', () => {
    const result = quote({ nightlyRate: '650.00', depositPercentage: '50.00', nights: 3 });
    expect(result.totalCents).toBe(195_000);
    expect(result.depositCents).toBe(97_500);
    expect(result.balanceCents).toBe(97_500);
  });

  it('não perde centavo com diária fracionada', () => {
    // 199,99 x 7 = 1399,93 — em float daria 1399,9299999999998.
    const result = quote({ nightlyRate: '199.99', depositPercentage: '50.00', nights: 7 });
    expect(result.totalCents).toBe(139_993);
    expect(result.depositCents + result.balanceCents).toBe(result.totalCents);
  });

  it('sinal e saldo sempre fecham com o total', () => {
    for (const nights of [1, 2, 3, 5, 11]) {
      const result = quote({ nightlyRate: '333.33', depositPercentage: '33.33', nights });
      expect(result.depositCents + result.balanceCents).toBe(result.totalCents);
    }
  });

  it('recusa valores impossíveis', () => {
    expect(() => quote({ nightlyRate: '650', depositPercentage: '50', nights: 0 })).toThrow();
    expect(() => quote({ nightlyRate: '650', depositPercentage: '50', nights: 1.5 })).toThrow();
    expect(() => quote({ nightlyRate: '-1', depositPercentage: '50', nights: 2 })).toThrow();
    expect(() => quote({ nightlyRate: '650', depositPercentage: '101', nights: 2 })).toThrow();
  });
});

describe('centsToNumeric', () => {
  it('produz string compatível com NUMERIC(12,2)', () => {
    expect(centsToNumeric(195_000)).toBe('1950.00');
    expect(centsToNumeric(5)).toBe('0.05');
    expect(centsToNumeric(0)).toBe('0.00');
  });
});

describe('formatBRL', () => {
  it('formata em português', () => {
    expect(formatBRL(195_000).replace(/\u00a0/g, ' ')).toBe('R$ 1.950,00');
  });
});
