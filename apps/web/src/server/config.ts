/**
 * Configuração de ambiente com validação preguiçosa.
 *
 * Em serverless, um `parse` no topo do módulo derruba TODA a aplicação quando
 * uma única variável opcional falta — inclusive a vitrine pública. Cada segredo
 * é validado apenas quando a rota que depende dele é chamada.
 */

const isProduction = process.env.NODE_ENV === 'production';

function required(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new ConfigError(
      `Variável de ambiente ${name} ausente ou curta demais (mínimo ${minLength} caracteres).`
    );
  }
  return value;
}

export class ConfigError extends Error {
  readonly code = 'CONFIGURATION_ERROR';
}

export const config = {
  isProduction,

  /** Connection string PostgreSQL. Use o pooler (porta 6543 no Supabase). */
  get databaseUrl() {
    return required('DATABASE_URL');
  },

  get databaseSsl() {
    return (process.env.DATABASE_SSL ?? 'true') === 'true';
  },

  /** Segredo de assinatura do access token. */
  get jwtSecret() {
    return required('JWT_SECRET', 32);
  },

  /** Segredo compartilhado com o provedor de pagamento. */
  get paymentWebhookSecret() {
    return required('PAYMENT_WEBHOOK_SECRET', 16);
  },

  /** Preenchido automaticamente pelo Vercel quando há cron configurado. */
  get cronSecret() {
    return required('CRON_SECRET', 16);
  },

  /** Slug da propriedade exibida na vitrine. */
  get propertySlug() {
    return process.env.PROPERTY_SLUG ?? 'flat-praia-de-carneiros';
  }
};

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
