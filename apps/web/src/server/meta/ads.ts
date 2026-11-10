import { z } from 'zod';
import { credAds, credInstagram } from '../integracoes/store';
import { query, transaction } from '../db';
import { addDaysIso, isIsoDate, todayIso } from '../dates';
import { badRequest } from '../errors';
import { graph, graphPages } from './graph';
import { normalizarInsight, type InsightLinha } from './insights';
import { eventosInstagram, type Evento } from '../atendimento/payloads';
import { processarEventos } from '../atendimento/inbox';

/**
 * Sincronização com a Meta e o relatório que cruza GASTO (Meta) com RESERVA
 * (nosso banco).
 *
 * A Meta sabe quanto custou e quantos cliques houve; quem sabe se o clique
 * virou reserva paga somos nós. O relatório junta os dois por `ad_id` — é ele
 * que responde "qual anúncio gerou aquela reserva" e "quanto custou cada uma".
 */

const CAMPOS_INSIGHTS = [
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'account_id',
  'spend',
  'impressions',
  'clicks',
  'inline_link_clicks',
  'actions'
].join(',');

async function registrarExecucao<T extends Record<string, unknown>>(
  tipo: string,
  trabalho: () => Promise<T>
): Promise<T> {
  const run = await query<{ id: string }>(
    `INSERT INTO meta_sync_runs (tipo) VALUES ($1) RETURNING id`,
    [tipo]
  );
  const id = run.rows[0]!.id;
  try {
    const resultado = await trabalho();
    await query(
      `UPDATE meta_sync_runs SET concluido_em = now(), ok = true, detalhe = $2 WHERE id = $1`,
      [id, JSON.stringify(resultado)]
    );
    return resultado;
  } catch (error) {
    const detalhe = (error as { details?: unknown; code?: string }) ?? {};
    await query(
      `UPDATE meta_sync_runs SET concluido_em = now(), ok = false, detalhe = $2 WHERE id = $1`,
      [id, JSON.stringify({ erro: detalhe.code ?? 'ERRO', detalhes: detalhe.details ?? null })]
    );
    throw error;
  }
}

/**
 * Puxa métricas diárias por anúncio. A Meta reprocessa atribuição por até
 * 28 dias, então reler a janela inteira e sobrescrever (UPSERT) é o correto —
 * não "só o dia novo".
 */
export async function sincronizarAnuncios(dias = 30) {
  return registrarExecucao('ANUNCIOS', async () => {
    const ads = await credAds();
    if (!ads.accountId || !ads.token) throw badRequest('META_ADS_NOT_CONFIGURED');
    const ate = todayIso();
    const desde = addDaysIso(ate, -(dias - 1));

    const linhas = await graphPages<InsightLinha>(`${ads.accountId}/insights`, {
      token: ads.token,
      params: {
        level: 'ad',
        fields: CAMPOS_INSIGHTS,
        time_increment: 1,
        time_range: JSON.stringify({ since: desde, until: ate }),
        limit: 500
      }
    });

    const normalizadas = linhas.map(normalizarInsight).filter((l) => l !== null);

    await transaction(async (client) => {
      for (const l of normalizadas) {
        await client.query(
          `INSERT INTO meta_ads (ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, account_id, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (ad_id) DO UPDATE SET
             ad_name = COALESCE(EXCLUDED.ad_name, meta_ads.ad_name),
             adset_id = COALESCE(EXCLUDED.adset_id, meta_ads.adset_id),
             adset_name = COALESCE(EXCLUDED.adset_name, meta_ads.adset_name),
             campaign_id = COALESCE(EXCLUDED.campaign_id, meta_ads.campaign_id),
             campaign_name = COALESCE(EXCLUDED.campaign_name, meta_ads.campaign_name),
             account_id = COALESCE(EXCLUDED.account_id, meta_ads.account_id),
             synced_at = now()`,
          [l.adId, l.adName, l.adsetId, l.adsetName, l.campaignId, l.campaignName, l.accountId]
        );
        await client.query(
          `INSERT INTO meta_ad_insights (ad_id, dia, spend, impressions, clicks, link_clicks,
                                         leads_meta, conversas_iniciadas, actions, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           ON CONFLICT (ad_id, dia) DO UPDATE SET
             spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
             link_clicks = EXCLUDED.link_clicks, leads_meta = EXCLUDED.leads_meta,
             conversas_iniciadas = EXCLUDED.conversas_iniciadas, actions = EXCLUDED.actions,
             synced_at = now()`,
          [l.adId, l.dia, l.spend, l.impressions, l.clicks, l.linkClicks, l.leads, l.conversas,
           JSON.stringify(l.actions)]
        );
      }

      // Leads que chegaram antes da sincronização ganham conjunto e campanha.
      await client.query(
        `UPDATE crm_leads l SET
            adset_id = COALESCE(l.adset_id, a.adset_id),
            campaign_id = COALESCE(l.campaign_id, a.campaign_id)
           FROM meta_ads a
          WHERE a.ad_id = l.ad_id AND (l.adset_id IS NULL OR l.campaign_id IS NULL)`
      );
    });

    return { desde, ate, linhas: linhas.length, gravadas: normalizadas.length };
  });
}

// ---------------------------------------------------------------------------
// Instagram Direct — importação do histórico
// ---------------------------------------------------------------------------

type IgConversa = {
  id: string;
  participants?: { data?: { id: string; username?: string }[] };
  messages?: {
    data?: {
      id: string;
      message?: string;
      created_time?: string;
      from?: { id: string; username?: string };
      to?: { data?: { id: string }[] };
    }[];
  };
};

/**
 * O webhook só entrega o que chega DEPOIS de assinado. Conversas antigas do
 * Direct entram por aqui, traduzidas para o mesmo formato do webhook e
 * gravadas pelo mesmo caminho — idempotente, então rodar de novo não duplica.
 */
export async function importarConversasInstagram(limiteConversas = 50) {
  return registrarExecucao('INSTAGRAM', async () => {
    const ig = await credInstagram();
    const contaPropria = ig.igAccountId;
    if (!contaPropria) throw badRequest('META_IG_ACCOUNT_ID_REQUIRED');
    if (!ig.pageId || !ig.pageToken) throw badRequest('INSTAGRAM_NOT_CONFIGURED');

    const resposta = await graph<{ data?: IgConversa[] }>(`${ig.pageId}/conversations`, {
      token: ig.pageToken,
      params: {
        platform: 'instagram',
        fields: 'id,participants,messages.limit(25){id,message,created_time,from,to}',
        limit: Math.min(limiteConversas, 100)
      }
    });

    // Monta um payload no formato do webhook para reaproveitar o tradutor.
    const messaging = (resposta.data ?? []).flatMap((conversa) =>
      (conversa.messages?.data ?? [])
        .filter((m) => m.from?.id && m.to?.data?.[0]?.id)
        .map((m) => ({
          sender: { id: m.from!.id },
          recipient: { id: m.to!.data![0]!.id },
          timestamp: m.created_time ? Date.parse(m.created_time) : Date.now(),
          message: { mid: m.id, text: m.message ?? '', is_echo: m.from!.id === contaPropria }
        }))
    );
    // Mais antigas primeiro: a prévia da conversa termina na última mensagem.
    messaging.sort((a, b) => a.timestamp - b.timestamp);

    const eventos: Evento[] = eventosInstagram(
      { object: 'instagram', entry: [{ id: contaPropria, messaging }] },
      contaPropria
    );
    // Importação de histórico não aciona o agente: são conversas antigas.
    const { resumo } = await processarEventos(eventos);
    return { conversas: resposta.data?.length ?? 0, ...resumo };
  });
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

const dataIso = z.string().refine(isIsoDate, 'Use o formato YYYY-MM-DD');
export const relatorioSchema = z
  .object({ de: dataIso.optional(), ate: dataIso.optional() })
  .transform((v) => {
    const ate = v.ate ?? todayIso();
    return { de: v.de ?? addDaysIso(ate, -29), ate };
  })
  .refine((v) => v.de <= v.ate, 'Período invertido');

export async function relatorioAnuncios(periodo: z.infer<typeof relatorioSchema>) {
  const { de, ate } = periodo;

  /*
   * Reserva → anúncio: primeiro pelo card da própria reserva (atribuição do
   * site); se ele não tiver anúncio, pela conversa ligada à reserva (lead que
   * veio de click-to-WhatsApp e reservou depois).
   */
  const RESERVA_ANUNCIO = `
    reserva_anuncio AS (
      SELECT DISTINCT ON (r.id) r.id, a.ad_id, a.origem_canal, r.total_amount, r.status,
             r.payment_status, r.created_at, r.check_in, r.check_out, r.customer_id, r.property_id
        FROM reservations r
        JOIN LATERAL (
          SELECT l.ad_id, l.origem_canal, 1 AS prioridade
            FROM crm_leads l WHERE l.reservation_id = r.id AND l.ad_id IS NOT NULL
          UNION ALL
          SELECT l.ad_id, l.origem_canal, 2
            FROM conversas_whatsapp c JOIN crm_leads l ON l.id = c.lead_id
           WHERE c.reserva_id = r.id AND l.ad_id IS NOT NULL
        ) a ON true
       WHERE r.created_at >= $1::date AND r.created_at < ($2::date + 1)
       ORDER BY r.id, a.prioridade
    )`;

  const porAnuncio = await query(
    `WITH gasto AS (
        SELECT ad_id, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
               SUM(link_clicks) AS link_clicks, SUM(leads_meta) AS leads_meta,
               SUM(conversas_iniciadas) AS conversas_meta
          FROM meta_ad_insights WHERE dia BETWEEN $1::date AND $2::date GROUP BY ad_id
     ),
     leads AS (
        SELECT ad_id, COUNT(*) AS leads
          FROM crm_leads
         WHERE ad_id IS NOT NULL AND created_at >= $1::date AND created_at < ($2::date + 1)
         GROUP BY ad_id
     ),
     ${RESERVA_ANUNCIO},
     reservas AS (
        SELECT ra.ad_id,
               COUNT(*) AS reservas,
               COUNT(*) FILTER (WHERE ra.payment_status IN ('PARTIAL', 'PAID')
                                  OR ra.status IN ('CONFIRMED', 'COMPLETED')) AS confirmadas,
               COALESCE(SUM(ra.total_amount) FILTER (WHERE ra.status NOT IN ('CANCELLED', 'EXPIRED')), 0)
                 AS valor_reservado,
               COALESCE(SUM(pg.pago), 0) AS recebido
          FROM reserva_anuncio ra
          LEFT JOIN LATERAL (
            SELECT SUM(p.amount) AS pago FROM payments p
             WHERE p.reservation_id = ra.id AND p.status = 'PAID'
          ) pg ON true
         GROUP BY ra.ad_id
     ),
     ids AS (SELECT ad_id FROM gasto UNION SELECT ad_id FROM leads UNION SELECT ad_id FROM reservas)
     SELECT ids.ad_id, a.ad_name, a.adset_name, a.campaign_id, a.campaign_name,
            COALESCE(g.spend, 0) AS spend, COALESCE(g.impressions, 0) AS impressions,
            COALESCE(g.clicks, 0) AS clicks, COALESCE(g.link_clicks, 0) AS link_clicks,
            COALESCE(g.leads_meta, 0) AS leads_meta, COALESCE(g.conversas_meta, 0) AS conversas_meta,
            COALESCE(l.leads, 0) AS leads, COALESCE(r.reservas, 0) AS reservas,
            COALESCE(r.confirmadas, 0) AS confirmadas,
            COALESCE(r.valor_reservado, 0) AS valor_reservado, COALESCE(r.recebido, 0) AS recebido
       FROM ids
       LEFT JOIN meta_ads a ON a.ad_id = ids.ad_id
       LEFT JOIN gasto g ON g.ad_id = ids.ad_id
       LEFT JOIN leads l ON l.ad_id = ids.ad_id
       LEFT JOIN reservas r ON r.ad_id = ids.ad_id
      ORDER BY COALESCE(g.spend, 0) DESC, COALESCE(r.reservas, 0) DESC`,
    [de, ate]
  );

  const porCanal = await query(
    `SELECT COALESCE(origem_canal, 'SEM_ORIGEM') AS canal, COUNT(*) AS leads,
            COUNT(reservation_id) AS com_reserva
       FROM crm_leads
      WHERE created_at >= $1::date AND created_at < ($2::date + 1)
      GROUP BY 1 ORDER BY 2 DESC`,
    [de, ate]
  );

  const reservas = await query(
    `WITH ${RESERVA_ANUNCIO}
     SELECT ra.id, ra.check_in::text AS check_in, ra.check_out::text AS check_out,
            ra.status::text AS status, ra.payment_status::text AS payment_status,
            ra.total_amount, ra.created_at, ra.ad_id, ra.origem_canal,
            u.full_name AS hospede, COALESCE(p.short_name, p.name) AS unidade, p.color AS unidade_cor,
            a.ad_name, a.campaign_name
       FROM reserva_anuncio ra
       JOIN users u ON u.id = ra.customer_id
       JOIN properties p ON p.id = ra.property_id
       LEFT JOIN meta_ads a ON a.ad_id = ra.ad_id
      ORDER BY ra.created_at DESC
      LIMIT 100`,
    [de, ate]
  );

  const ultimaSync = await query(
    `SELECT DISTINCT ON (tipo) tipo, iniciado_em, concluido_em, ok, detalhe
       FROM meta_sync_runs ORDER BY tipo, iniciado_em DESC`
  );

  return {
    periodo: { de, ate },
    anuncios: porAnuncio.rows,
    porCanal: porCanal.rows,
    reservas: reservas.rows,
    sincronizacoes: ultimaSync.rows,
    configurado: {
      anuncios: (await credAds()).configurado,
      instagram: (await credInstagram()).configurado
    }
  };
}
