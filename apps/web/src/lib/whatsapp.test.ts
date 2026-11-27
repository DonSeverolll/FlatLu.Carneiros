import { describe, expect, it } from 'vitest';
import { numeroWhatsapp } from './whatsapp';

describe('numeroWhatsapp', () => {
  it('põe o DDI do Brasil em número com DDD', () => {
    expect(numeroWhatsapp('(81) 99999-1234')).toBe('5581999991234');
    expect(numeroWhatsapp('81 3333-1234')).toBe('558133331234');
  });
  it('mantém número que já tem DDI', () => {
    expect(numeroWhatsapp('+55 81 99999-1234')).toBe('5581999991234');
  });
  it('recusa vazio ou curto demais', () => {
    expect(numeroWhatsapp('')).toBeNull();
    expect(numeroWhatsapp(undefined)).toBeNull();
    expect(numeroWhatsapp('99999-1234')).toBeNull();
  });
});
