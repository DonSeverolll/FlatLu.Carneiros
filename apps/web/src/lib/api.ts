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
  DAY_USE_NOT_ALLOWED: 'Este espaço não é alugado por um dia só. Escolha pelo menos uma noite.',
  BLOCK_NOT_FOUND: 'Bloqueio não encontrado.',
  BLOCK_ALREADY_RELEASED: 'Este bloqueio já foi liberado.',
  BLOCK_BELONGS_TO_RESERVATION:
    'Estas datas estão presas a uma reserva. Cancele a reserva para liberá-las.',
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
    'Já existe um período ativo com essa prioridade nessas datas.',

  // Atendimento e Meta
  WINDOW_CLOSED:
    'Passaram 24h desde a última mensagem do cliente. Envie um modelo aprovado.',
  MESSAGING_NOT_CONFIGURED:
    'O envio por este canal ainda não foi configurado. Veja as variáveis META_* e WHATSAPP_*.',
  CONVERSATION_NOT_FOUND: 'Conversa não encontrada.',
  MESSAGE_NOT_FOUND: 'Mensagem não encontrada.',
  MEDIA_NOT_FOUND: 'Mídia não encontrada.',
  META_API_ERROR: 'A Meta recusou ou não respondeu. Detalhe gravado na mensagem.',
  MESSAGE_SEND_FAILED: 'A mensagem não saiu. Tente de novo.',
  FILE_TOO_LARGE: 'Arquivo acima de 4 MB. Para vídeo, use "Mídia por link".',
  FILE_TYPE_NOT_ALLOWED: 'Tipo de arquivo não aceito. Use PDF, JPG, PNG, WEBP ou MP4.',
  INVALID_UPLOAD: 'Não foi possível ler o arquivo.',
  INSTAGRAM_NEEDS_MEDIA_URL: 'No Instagram Direct, anexo só por URL pública.',
  TEMPLATE_WHATSAPP_ONLY: 'Modelos existem só no WhatsApp.',
  SIMULATION_DISABLED: 'O simulador só funciona com WHATSAPP_PROVIDER=simulado.',
  LEAD_WITHOUT_PHONE: 'Este lead não tem telefone cadastrado.',
  META_IG_ACCOUNT_ID_REQUIRED: 'Informe o ID da conta do Instagram em Configurações › Integrações.',
  META_ADS_NOT_CONFIGURED: 'Conecte a conta de anúncios em Configurações › Integrações.',
  INSTAGRAM_NOT_CONFIGURED: 'Conecte o Instagram em Configurações › Integrações.',

  // Configurações e agente de IA
  INTEGRATIONS_KEY_MISSING:
    'O servidor não tem INTEGRATIONS_ENCRYPTION_KEY: tokens só podem vir de variáveis de ambiente.',
  INTEGRATION_SECRETS_UNREADABLE: 'Os tokens salvos não abrem com a chave atual. Digite-os de novo.',
  AI_NOT_CONFIGURED: 'Falta a chave da API da Anthropic em Configurações › Agente de IA.',
  AI_DISABLED: 'O agente de IA está desligado em Configurações.',
  AI_NOTHING_TO_ANSWER: 'Não há mensagem do cliente para responder.',
  AI_AUTH_FAILED: 'A Anthropic recusou a chave da API. Confira em Configurações.',
  AI_RATE_LIMITED: 'Limite de uso da API atingido. Tente em instantes.',
  AI_PROVIDER_ERROR: 'O agente de IA não respondeu agora. Tente de novo.',
  MEDIA_WITHOUT_PROPERTY: 'Escolha o espaço da foto antes de torná-la capa.',
  NO_PROPERTIES: 'Nenhum espaço ativo para classificar.'
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
