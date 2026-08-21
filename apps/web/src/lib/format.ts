export function brl(value: string | number): string {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** `2026-09-14` -> `14 de set` (sem passar por Date local, que erra o fuso). */
export function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

export function longDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  COMPLETED: 'Concluída',
  EXPIRED: 'Expirada'
};

export const PAYMENT_LABEL: Record<string, string> = {
  PENDING: 'pagamento pendente',
  PARTIAL: 'sinal pago',
  PAID: 'pago',
  REFUNDED: 'reembolsado',
  FAILED: 'falhou'
};
