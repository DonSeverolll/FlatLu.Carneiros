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

/** Origem de um bloqueio de datas, como o painel apresenta. */
export const BLOCK_SOURCE: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | '' }> = {
  RESERVATION: { label: 'Reserva', tone: 'good' },
  MAINTENANCE: { label: 'Manutenção', tone: 'warn' },
  CLEANING: { label: 'Limpeza', tone: '' },
  OWNER_USE: { label: 'Uso do proprietário', tone: '' }
};

/**
 * Rótulos do log. O que não estiver aqui aparece com o código cru — é
 * preferível a inventar um nome bonito para um evento que ninguém reconhece.
 */
export const AUDIT_LABEL: Record<string, string> = {
  LOGIN: 'Entrou no sistema',
  LOGIN_FAILED: 'Tentativa de entrada recusada',
  LOGOUT: 'Saiu do sistema',
  USER_REGISTERED: 'Cadastro criado',
  PASSWORD_CHANGED: 'Senha alterada',
  PASSWORD_RESET_BY_ADMIN: 'Senha redefinida pelo administrador',
  UPDATED_BY_ADMIN: 'Dados alterados pelo administrador',
  CREATED: 'Reserva criada',
  CANCELLED: 'Reserva cancelada',
  NOTES_UPDATED: 'Observações alteradas',
  STAY_CHECK_IN: 'Chegada registrada',
  STAY_CHECK_OUT: 'Saída registrada',
  STAY_UNDO: 'Registro de estadia desfeito',
  PAYMENT_PAID: 'Pagamento total confirmado',
  PAYMENT_PARTIAL: 'Sinal confirmado',
  PAYMENT_PROCESSING: 'Pagamento em processamento',
  PAYMENT_DECLINED: 'Pagamento negado',
  PAYMENT_FAILED: 'Pagamento falhou',
  PAYMENT_REFUNDED: 'Pagamento reembolsado',
  PAYMENT_CANCELLED: 'Pagamento cancelado',
  SIGNED: 'Contrato assinado',
  BLOCK_CREATED: 'Datas bloqueadas',
  BLOCK_RELEASED: 'Bloqueio liberado',
  RATE_PERIOD_CREATED: 'Período especial criado',
  RATE_PERIOD_UPDATED: 'Período especial alterado',
  RATE_PERIOD_DELETED: 'Período especial removido',
  UPDATED: 'Espaço atualizado'
};

/** Eventos que merecem destaque visual no log. */
export const AUDIT_TONE: Record<string, 'good' | 'warn' | 'bad'> = {
  LOGIN_FAILED: 'bad',
  PAYMENT_DECLINED: 'bad',
  PAYMENT_FAILED: 'bad',
  CANCELLED: 'bad',
  PAYMENT_REFUNDED: 'warn',
  PAYMENT_CANCELLED: 'warn',
  BLOCK_CREATED: 'warn',
  PASSWORD_RESET_BY_ADMIN: 'warn',
  BLOCK_RELEASED: 'good',
  PAYMENT_PAID: 'good',
  PAYMENT_PARTIAL: 'good',
  SIGNED: 'good',
  CREATED: 'good'
};

export const ENTITY_LABEL: Record<string, string> = {
  USER: 'Usuário',
  RESERVATION: 'Reserva',
  PROPERTY: 'Espaço',
  CONTRACT: 'Contrato',
  PAYMENT: 'Pagamento',
  SESSION: 'Acesso'
};

/** Data e hora completas, para o log — onde a ordem dos fatos importa. */
export function dateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
