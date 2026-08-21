import { describe, expect, it } from 'vitest';
import { nextReservationStatus } from './payment';

describe('nextReservationStatus', () => {
  it('pagamento integral confirma a reserva', () => {
    expect(nextReservationStatus('PAID', 'PENDING_PAYMENT')).toBe('CONFIRMED');
  });

  it('pagamento parcial mantém a reserva viva em vez de deixá-la expirar', () => {
    // Era o bug: PARTIAL seguia em PENDING_PAYMENT e o varredor de holds
    // marcava EXPIRED, liberando a data de quem já havia pagado o sinal.
    expect(nextReservationStatus('PARTIAL', 'PENDING_PAYMENT')).toBe('PENDING_PAYMENT');
  });

  it('pagamento parcial não rebaixa reserva já confirmada', () => {
    expect(nextReservationStatus('PARTIAL', 'CONFIRMED')).toBe('CONFIRMED');
  });

  it('falha expira e reembolso cancela', () => {
    expect(nextReservationStatus('FAILED', 'PENDING_PAYMENT')).toBe('EXPIRED');
    expect(nextReservationStatus('REFUNDED', 'CONFIRMED')).toBe('CANCELLED');
  });
});
