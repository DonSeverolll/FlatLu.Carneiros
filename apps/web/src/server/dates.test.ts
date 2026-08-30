import { describe, expect, it } from 'vitest';
import { addDaysIso, isIsoDate, nightsBetween, todayIso } from './dates';

describe('isIsoDate', () => {
  it('aceita datas civis válidas', () => {
    expect(isIsoDate('2026-09-14')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });

  it('rejeita formato e datas inexistentes', () => {
    expect(isIsoDate('14/09/2026')).toBe(false);
    expect(isIsoDate('2026-9-14')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });
});

describe('nightsBetween', () => {
  it('conta noites, não dias', () => {
    expect(nightsBetween('2026-09-14', '2026-09-17')).toBe(3);
    expect(nightsBetween('2026-09-14', '2026-09-14')).toBe(0);
  });

  it('atravessa mês e ano', () => {
    expect(nightsBetween('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('acerta na virada entre meses de tamanhos diferentes', () => {
    // O caso que escapou: com o mês em base errada, junho (30 dias) virava
    // julho (31) e a conta ganhava uma noite. Dezembro→janeiro passava por
    // acaso, porque os dois têm 31 dias.
    expect(nightsBetween('2027-06-28', '2027-07-01')).toBe(3);
    expect(nightsBetween('2026-01-30', '2026-02-02')).toBe(3);
    expect(nightsBetween('2026-02-27', '2026-03-02')).toBe(3);
    expect(nightsBetween('2028-02-27', '2028-03-01')).toBe(3);
    expect(nightsBetween('2026-04-29', '2026-05-02')).toBe(3);
  });

  it('a soma de noites bate com a contagem dia a dia, mês a mês', () => {
    // Varre um ano inteiro comparando com a contagem por iteração.
    for (let mes = 1; mes <= 12; mes += 1) {
      const inicio = `2027-${String(mes).padStart(2, '0')}-27`;
      const fim = addDaysIso(inicio, 5);
      expect(nightsBetween(inicio, fim)).toBe(5);
    }
  });

  it('não é afetado por horário de verão (não há float de fuso no cálculo)', () => {
    expect(nightsBetween('2026-10-17', '2026-10-19')).toBe(2);
  });

  it('fica negativo quando invertido, para o chamador recusar', () => {
    expect(nightsBetween('2026-09-17', '2026-09-14')).toBe(-3);
  });
});

describe('addDaysIso', () => {
  it('soma e subtrai atravessando bordas', () => {
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('todayIso', () => {
  it('usa o fuso do imóvel, não o do servidor', () => {
    // 2026-09-15T02:00Z ainda é dia 14 em Recife (UTC-3).
    const instant = new Date('2026-09-15T02:00:00Z');
    expect(todayIso('America/Recife', instant)).toBe('2026-09-14');
    expect(todayIso('UTC', instant)).toBe('2026-09-15');
  });
});
