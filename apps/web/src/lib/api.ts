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
  RATE_NOT_PUBLISHED: 'A diária ainda não foi publicada. Fale com o anfitrião.',
  PAYMENT_METHOD_NOT_CONFIGURED: 'O pagamento ainda não foi configurado pelo anfitrião.',
  RESERVATION_NOT_PAYABLE: 'Esta reserva não está mais aberta para pagamento.',
  ALREADY_PAID: 'Esta reserva já está paga.',
  RESERVATION_NOT_FOUND: 'Reserva não encontrada.',
  PROPERTY_NOT_FOUND: 'Imóvel não encontrado.',
  NO_FIELDS_TO_UPDATE: 'Nada foi alterado.',
  SERVICE_NOT_CONFIGURED: 'Serviço em configuração. Tente novamente mais tarde.',
  INVALID_INPUT: 'Confira os dados informados.',
  CROSS_ORIGIN_BLOCKED: 'Requisição bloqueada por segurança. Recarregue a página.',
  INTERNAL_ERROR: 'Algo deu errado do nosso lado. Tente novamente.'
};

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'BELOW_MIN_NIGHTS') {
      const min = (error.details as { minNights?: number } | undefined)?.minNights;
      return min ? `A estadia mínima é de ${min} noites.` : MESSAGES.BELOW_MIN_NIGHTS;
    }
    if (error.code === 'ABOVE_MAX_GUESTS') {
      const max = (error.details as { maxGuests?: number } | undefined)?.maxGuests;
      return max ? `O flat acomoda até ${max} hóspedes.` : MESSAGES.ABOVE_MAX_GUESTS;
    }
    return MESSAGES[error.code] ?? 'Não foi possível concluir. Tente novamente.';
  }
  return 'Falha de conexão. Verifique sua internet.';
}
