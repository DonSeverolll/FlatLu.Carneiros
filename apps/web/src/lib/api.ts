'use client';

/**
 * Cliente HTTP do front-end.
 *
 * Duas coisas mudaram em relação à versão anterior:
 *
 * 1. URLs relativas (`/api/...`). Web e API vivem no mesmo domínio, então o
 *    cookie de sessão viaja sem depender de `SameSite=None` nem de CORS — era
 *    justamente isso que quebraria silenciosamente em domínios diferentes.
 * 2. Renovação automática. Ao receber 401, tenta `/api/auth/refresh` uma única
 *    vez e repete a requisição. Antes, o token de 15 minutos expirava no meio
 *    da reserva e o hóspede era jogado para fora.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(code);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      // Libera para uma próxima tentativa depois que esta resolveu.
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

type RequestOptions = { method?: string; body?: unknown; retryOnUnauthorized?: boolean };

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, retryOnUnauthorized = true } = options;

  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (response.status === 401 && retryOnUnauthorized && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) {
      return api<T>(path, { ...options, retryOnUnauthorized: false });
    }
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as { error?: string; details?: unknown } | null;
    throw new ApiError(response.status, error?.error ?? 'REQUEST_FAILED', error?.details);
  }
  return payload as T;
}

/** Mensagens em português para os códigos que a API devolve. */
const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Entre na sua conta para continuar.',
  INVALID_CREDENTIALS: 'E-mail ou senha inválidos.',
  EMAIL_ALREADY_REGISTERED: 'Este e-mail já tem conta. Tente entrar.',
  TOO_MANY_REQUESTS: 'Muitas tentativas. Aguarde alguns minutos.',
  DATES_UNAVAILABLE: 'Estas datas acabaram de ser ocupadas. Escolha outras.',
  CHECKOUT_BEFORE_CHECKIN: 'A saída precisa ser depois da entrada.',
  CHECKIN_IN_THE_PAST: 'A data de entrada já passou.',
  BELOW_MIN_NIGHTS: 'A estadia é menor que o mínimo de noites.',
  ABOVE_MAX_GUESTS: 'Número de hóspedes acima da capacidade do flat.',
  BEYOND_BOOKING_HORIZON: 'Ainda não abrimos reservas para essa data.',
  RATE_NOT_PUBLISHED: 'A tarifa dessas datas ainda não foi publicada. Fale com o anfitrião.',
  NIGHTS_NOT_BOOKABLE: 'Uma das noites escolhidas não é alugada avulsa.',
  ARRIVAL_NOT_ALLOWED: 'Não há check-in neste dia da semana.',
  PERIOD_REQUIRES_FULL_STAY: 'Esse período é vendido como pacote fechado.',
  PAYMENT_METHOD_NOT_CONFIGURED: 'O pagamento ainda não foi configurado pelo anfitrião.',
  RESERVATION_NOT_PAYABLE: 'Esta reserva não está mais aberta para pagamento.',
  ALREADY_PAID: 'Esta reserva já está paga.',
  RESERVATION_NOT_FOUND: 'Reserva não encontrada.',
  PROPERTY_NOT_FOUND: 'Imóvel não encontrado.',
  NO_FIELDS_TO_UPDATE: 'Nada foi alterado.',
  SERVICE_NOT_CONFIGURED: 'Serviço em configuração. Tente novamente mais tarde.',
  INVALID_INPUT: 'Confira os dados informados.',
  CROSS_ORIGIN_BLOCKED: 'Requisição bloqueada por segurança. Recarregue a página.',
  REFRESH_RACE: 'Sessão sendo renovada. Tente de novo em instantes.',
  REFRESH_TOKEN_REUSED: 'Sua sessão foi encerrada por segurança. Entre novamente.',
  SESSION_EXPIRED: 'Sua sessão expirou. Entre novamente.',
  INTERNAL_ERROR: 'Algo deu errado do nosso lado. Tente novamente.',

  // Pagamento
  PAYMENT_PROVIDER_NOT_CONFIGURED:
    'Pagamento com cartão ainda não está disponível. Use o Pix ou fale com o anfitrião.',
  PAYMENT_PROVIDER_ERROR:
    'O provedor de pagamento não respondeu. Tente em instantes ou pague por Pix.',
  DEPOSIT_NOT_PAID: 'O sinal precisa ser pago antes do saldo.',
  NOTHING_TO_CHARGE: 'Não há valor a cobrar nesta reserva.',

  // Contrato
  CONTRACT_NOT_SIGNED: 'Assine o contrato antes de seguir para o pagamento.',
  CONTRACT_NOT_FOUND: 'Contrato não encontrado.',
  CONTRACT_TEMPLATE_MISSING: 'Nenhum modelo de contrato ativo. Fale com o anfitrião.',
  CUSTOMER_DATA_INCOMPLETE: 'Complete seus dados para gerar o contrato.',
  CONTRACT_VARIABLES_MISSING: 'Faltam dados para gerar o contrato. Fale com o anfitrião.',
  PROPERTY_ADDRESS_MISSING:
    'O endereço deste espaço ainda não foi cadastrado, então o contrato não pode ser emitido.',
  RESERVATION_NOT_CONTRACTABLE: 'Esta reserva não está mais aberta.',
  SIGNER_NAME_MISMATCH: 'O nome digitado precisa ser igual ao do seu cadastro.',
  SIGNER_CPF_MISMATCH: 'O CPF digitado precisa ser igual ao do seu cadastro.',

  // Conta e painel
  CURRENT_PASSWORD_INVALID: 'Senha atual incorreta.',
  CANNOT_DEMOTE_SELF: 'Você não pode rebaixar nem suspender a própria conta.',
  USERNAME_ALREADY_TAKEN: 'Este nome de usuário já está em uso.',
  USERNAME_INVALID: 'Use de 3 a 80 caracteres: letras, números ou _.',
  USER_NOT_FOUND: 'Usuário não encontrado.',
  CUSTOMER_NOT_FOUND: 'Cliente não encontrado.',
  LEAD_NOT_FOUND: 'Card não encontrado.',
  RATE_PERIOD_NOT_FOUND: 'Período não encontrado.',
  PERIOD_OVERLAPS_EXISTING:
    'Já existe um período ativo com essa prioridade nessas datas.'
};

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'BELOW_MIN_NIGHTS') {
      const min = (error.details as { minNights?: number } | undefined)?.minNights;
      return min ? `A estadia mínima é de ${min} noites.` : MESSAGES.BELOW_MIN_NIGHTS;
    }
    if (error.code === 'ARRIVAL_NOT_ALLOWED') {
      const label = (error.details as { weekdayLabel?: string } | undefined)?.weekdayLabel;
      return label ? `Não há check-in em ${label.toLowerCase()}.` : MESSAGES.ARRIVAL_NOT_ALLOWED;
    }
    if (error.code === 'PERIOD_REQUIRES_FULL_STAY') {
      const d = error.details as { periodName?: string; startsOn?: string; endsOn?: string } | undefined;
      return d?.periodName
        ? `${d.periodName} é pacote fechado: a estadia precisa cobrir de ${d.startsOn} a ${d.endsOn}.`
        : MESSAGES.PERIOD_REQUIRES_FULL_STAY;
    }
    if (error.code === 'ABOVE_MAX_GUESTS') {
      const max = (error.details as { maxGuests?: number } | undefined)?.maxGuests;
      return max ? `O flat acomoda até ${max} hóspedes.` : MESSAGES.ABOVE_MAX_GUESTS;
    }
    return MESSAGES[error.code] ?? 'Não foi possível concluir. Tente novamente.';
  }
  return 'Falha de conexão. Verifique sua internet.';
}
