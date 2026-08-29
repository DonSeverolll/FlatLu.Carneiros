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
  PROCESSING: 'processando',
  PARTIAL: 'sinal pago',
  PAID: 'pago',
  DECLINED: 'negado',
  OVERDUE: 'em atraso',
  CANCELLED: 'cancelado',
  REFUNDED: 'reembolsado',
  FAILED: 'falhou'
};

/** Estado de uma cobrança, como o cliente lê no extrato. */
export const CHARGE_STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | '' }> = {
  PENDING: { label: 'Pendente', tone: 'warn' },
  PROCESSING: { label: 'Processando', tone: 'warn' },
  PAID: { label: 'Aprovado', tone: 'good' },
  PARTIAL: { label: 'Parcial', tone: 'warn' },
  DECLINED: { label: 'Negado', tone: 'bad' },
  OVERDUE: { label: 'Em atraso', tone: 'bad' },
  CANCELLED: { label: 'Cancelado', tone: '' },
  REFUNDED: { label: 'Reembolsado', tone: '' },
  FAILED: { label: 'Falhou', tone: 'bad' }
};

export const METHOD_LABEL: Record<string, string> = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  CASH: 'Dinheiro',
  TRANSFER: 'Transferência'
};

export const CHARGE_KIND: Record<string, string> = {
  DEPOSIT: 'Sinal',
  BALANCE: 'Saldo',
  FULL: 'Integral',
  EXTRA: 'Extra'
};

export const CRM_STAGE: Record<string, string> = {
  NEW: 'Novo',
  CONTACTED: 'Contatado',
  QUOTED: 'Orçado',
  NEGOTIATING: 'Negociando',
  WON: 'Fechado',
  LOST: 'Perdido'
};

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

/** "JUNHO 2025" — mês por índice 1-12, sem depender do fuso local. */
export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]?.toUpperCase() ?? month} ${year}`;
}

export const WEEKDAY_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

/** Monta a grade do mês com as lacunas iniciais, para alinhar sob DOM..SÁB. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return cells;
}

export function shiftMonth(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}
