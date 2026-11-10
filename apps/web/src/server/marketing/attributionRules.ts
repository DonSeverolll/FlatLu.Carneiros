import { z } from 'zod';

/**
 * Regras puras de atribuição: o que é aceito de uma URL de campanha e qual
 * canal ela representa. Sem banco aqui, para poder testar sem infraestrutura.
 */

export const CANAIS = [
  'META_ADS',
  'INSTAGRAM',
  'FACEBOOK',
  'WHATSAPP',
  'GOOGLE_ADS',
  'GOOGLE',
  'SITE',
  'INDICACAO',
  'MANUAL',
  'OUTRO'
] as const;
export type Canal = (typeof CANAIS)[number];

/**
 * ID de objeto da Meta: só dígitos. A checagem não é enfeite — a pré-visualização
 * do Gerenciador de Anúncios abre a URL com o parâmetro dinâmico NÃO resolvido
 * (`ad_id={{ad.id}}`), e gravar isso como anúncio sujaria o relatório.
 */
const metaId = z
  .string()
  .trim()
  .regex(/^\d{5,25}$/)
  .optional()
  .catch(undefined);

/** Texto livre de UTM: aparado, sem placeholder `{{...}}`, até 200 caracteres. */
const utm = z
  .string()
  .trim()
  .max(200)
  .refine((valor) => valor.length > 0 && !/\{\{.*\}\}/.test(valor))
  .optional()
  .catch(undefined);

const clickId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.\-]{8,500}$/)
  .optional()
  .catch(undefined);

/**
 * O corpo vem do navegador, então tudo é opcional e campo inválido vira
 * ausente em vez de derrubar a requisição: uma UTM malformada não deveria
 * custar o registro do anúncio que veio junto.
 */
export const touchSchema = z.object({
  utm_source: utm,
  utm_medium: utm,
  utm_campaign: utm,
  utm_content: utm,
  utm_term: utm,
  fbclid: clickId,
  gclid: clickId,
  ad_id: metaId,
  adset_id: metaId,
  campaign_id: metaId,
  landing_path: z
    .string()
    .max(500)
    .regex(/^\/[^\s]*$/)
    .optional()
    .catch(undefined),
  referrer: z.string().max(2000).optional().catch(undefined)
});
export type TouchInput = z.infer<typeof touchSchema>;

const CAMPOS_DE_CAMPANHA = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'ad_id',
  'adset_id',
  'campaign_id'
] as const;

/** Visita sem nenhum parâmetro de campanha não vira toque. */
export function temParametroDeCampanha(input: TouchInput): boolean {
  return CAMPOS_DE_CAMPANHA.some((campo) => Boolean(input[campo]));
}

const FONTES_META = new Set(['facebook', 'fb', 'meta', 'instagram', 'ig', 'an', 'msg']);
const MEIOS_PAGOS = new Set(['cpc', 'cpm', 'ppc', 'paid', 'paid_social', 'paidsocial', 'ads', 'ad', 'social_paid']);

/**
 * Canal a partir dos parâmetros. A ordem importa: um ID de anúncio ou clique
 * pago vence o `utm_source`, porque é o sinal que o anunciante não digita à mão.
 */
export function canalDoToque(input: TouchInput, referrerHost?: string | null): Canal {
  const fonte = input.utm_source?.toLowerCase() ?? '';
  const meio = input.utm_medium?.toLowerCase() ?? '';

  if (input.ad_id || input.adset_id || input.campaign_id) return 'META_ADS';
  if (input.gclid) return 'GOOGLE_ADS';
  if (FONTES_META.has(fonte) && MEIOS_PAGOS.has(meio)) return 'META_ADS';
  // fbclid sozinho aparece também em link orgânico compartilhado no Facebook.
  if (input.fbclid && MEIOS_PAGOS.has(meio)) return 'META_ADS';
  if (fonte === 'instagram' || fonte === 'ig') return 'INSTAGRAM';
  if (fonte === 'facebook' || fonte === 'fb' || input.fbclid) return 'FACEBOOK';
  if (fonte === 'whatsapp' || fonte === 'wa') return 'WHATSAPP';
  if (fonte === 'google') return MEIOS_PAGOS.has(meio) ? 'GOOGLE_ADS' : 'GOOGLE';
  if (fonte === 'indicacao' || meio === 'referral') return 'INDICACAO';

  const host = referrerHost?.toLowerCase() ?? '';
  if (host.endsWith('instagram.com')) return 'INSTAGRAM';
  if (host.endsWith('facebook.com')) return 'FACEBOOK';
  if (host.includes('google.')) return 'GOOGLE';

  return fonte ? 'OUTRO' : 'SITE';
}

/** Só o host do referrer: o caminho pode carregar dado pessoal (busca, e-mail). */
export function hostDoReferrer(referrer: string | undefined, hostProprio: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).host.toLowerCase().slice(0, 255);
    if (!host || host === hostProprio?.toLowerCase()) return null;
    return host;
  } catch {
    return null;
  }
}
