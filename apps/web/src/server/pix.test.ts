import { describe, expect, it } from 'vitest';
import { buildPixPayload, crc16, paymentReference } from './pix';

describe('crc16', () => {
  it('bate com o valor de verificação do CRC-16/CCITT-FALSE', () => {
    // Vetor padrão do algoritmo: CRC de "123456789" é 0x29B1.
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('buildPixPayload', () => {
  const base = {
    key: 'flat@carneiros.com.br',
    merchantName: 'Flat Praia de Carneiros',
    amountCents: 97_500,
    reference: 'CARNABCD2345'
  };

  it('monta o BR Code com os campos obrigatórios do Banco Central', () => {
    const payload = buildPixPayload(base);
    expect(payload.startsWith('000201')).toBe(true);
    expect(payload).toContain('br.gov.bcb.pix');
    expect(payload).toContain(base.key);
    expect(payload).toContain('5303986'); // moeda BRL
    expect(payload).toContain('5802BR'); // país
    expect(payload).toContain('5406975.00'); // tag 54, tamanho 06, R$ 975,00
  });

  it('fecha com CRC válido sobre o payload inteiro', () => {
    const payload = buildPixPayload(base);
    const body = payload.slice(0, -4);
    expect(body.endsWith('6304')).toBe(true);
    expect(payload.slice(-4)).toBe(crc16(body));
  });

  it('normaliza nome do recebedor para ASCII maiúsculo', () => {
    const payload = buildPixPayload({ ...base, merchantName: 'Pousada Açaí & Cia' });
    expect(payload).toContain('POUSADA ACAI CIA');
  });

  it('é determinístico para a mesma cobrança', () => {
    expect(buildPixPayload(base)).toBe(buildPixPayload(base));
  });

  it('recusa cobrança sem chave ou sem valor', () => {
    expect(() => buildPixPayload({ ...base, key: '  ' })).toThrow('PIX_KEY_REQUIRED');
    expect(() => buildPixPayload({ ...base, amountCents: 0 })).toThrow('PIX_AMOUNT_INVALID');
    expect(() => buildPixPayload({ ...base, amountCents: 10.5 })).toThrow('PIX_AMOUNT_INVALID');
  });

  it('respeita o limite de 25 caracteres do identificador', () => {
    const payload = buildPixPayload({ ...base, reference: 'X'.repeat(40) });
    expect(payload).toContain(`0525${'X'.repeat(25)}`);
  });
});

describe('paymentReference', () => {
  it('gera código legível, sem caracteres ambíguos', () => {
    const reference = paymentReference(() => 0.5);
    expect(reference).toMatch(/^CARN[A-Z2-9]{8}$/);
    expect(reference).not.toMatch(/[01IO]/);
  });

  it('varia entre chamadas', () => {
    const values = new Set(Array.from({ length: 50 }, () => paymentReference()));
    expect(values.size).toBeGreaterThan(40);
  });
});
