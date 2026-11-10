/**
 * Regras puras sobre o retorno de insights da Meta (sem rede, sem banco).
 */

export type MetaAction = { action_type?: string; value?: string | number };

export type InsightLinha = {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  account_id?: string;
  date_start?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
};

const numero = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function somaDe(actions: MetaAction[] | undefined, tipos: string[]): number | null {
  const encontrados = (actions ?? []).filter((a) => a.action_type && tipos.includes(a.action_type));
  if (!encontrados.length) return null;
  return encontrados.reduce((total, a) => total + numero(a.value), 0);
}

/**
 * Leads segundo a Meta. `lead` já é o agregado (pixel + formulário); somar os
 * subtipos junto contaria o mesmo lead duas vezes. Só caímos nos subtipos
 * quando o agregado não veio.
 */
export function leadsDaMeta(actions: MetaAction[] | undefined): number {
  return (
    somaDe(actions, ['lead']) ??
    somaDe(actions, ['onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']) ??
    0
  );
}

/** Conversas iniciadas por click-to-WhatsApp / click-to-Direct. */
export function conversasDaMeta(actions: MetaAction[] | undefined): number {
  return somaDe(actions, ['onsite_conversion.messaging_conversation_started_7d']) ?? 0;
}

export type InsightNormalizado = {
  adId: string;
  dia: string;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  accountId: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  leads: number;
  conversas: number;
  actions: MetaAction[];
};

export function normalizarInsight(linha: InsightLinha): InsightNormalizado | null {
  if (!linha.ad_id || !/^\d+$/.test(linha.ad_id)) return null;
  if (!linha.date_start || !/^\d{4}-\d{2}-\d{2}$/.test(linha.date_start)) return null;
  return {
    adId: linha.ad_id,
    dia: linha.date_start,
    adName: linha.ad_name?.slice(0, 400) ?? null,
    adsetId: linha.adset_id ?? null,
    adsetName: linha.adset_name?.slice(0, 400) ?? null,
    campaignId: linha.campaign_id ?? null,
    campaignName: linha.campaign_name?.slice(0, 400) ?? null,
    accountId: linha.account_id ?? null,
    spend: Math.round(numero(linha.spend) * 100) / 100,
    impressions: Math.trunc(numero(linha.impressions)),
    clicks: Math.trunc(numero(linha.clicks)),
    linkClicks: Math.trunc(numero(linha.inline_link_clicks)),
    leads: Math.trunc(leadsDaMeta(linha.actions)),
    conversas: Math.trunc(conversasDaMeta(linha.actions)),
    actions: linha.actions ?? []
  };
}
