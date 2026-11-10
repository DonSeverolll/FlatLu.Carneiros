import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { cookies } from 'next/headers';
import { config } from '../config';
import { query } from '../db';
import {
  canalDoToque,
  hostDoReferrer,
  temParametroDeCampanha,
  type TouchInput
} from './attributionRules';

/**
 * Atribuição de marketing.
 *
 * O navegador só relata os parâmetros com que chegou; quem grava, valida e
 * decide o canal é o servidor. O vínculo com o visitante é um cookie de
 * primeira parte, `httpOnly`, emitido aqui — o script da página não consegue
 * lê-lo nem trocá-lo.
 *
 * Modelo: o lead guarda o PRIMEIRO e o ÚLTIMO toque dos últimos 90 dias; as
 * colunas de UTM/anúncio do lead refletem o último (last click), que é o
 * critério que o próprio Gerenciador de Anúncios usa.
 */

export const VISITOR_COOKIE = 'mkt_vid';
const VISITOR_TTL_SECONDS = 60 * 60 * 24 * 180;
const JANELA_DE_ATRIBUICAO_DIAS = 90;
/** Recarregar a landing page não deve gerar um toque por recarga. */
const DEDUPE_MINUTOS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function visitorIdFromCookies(): Promise<string | null> {
  const valor = (await cookies()).get(VISITOR_COOKIE)?.value;
  return valor && UUID.test(valor) ? valor : null;
}

async function garantirVisitorId(): Promise<string> {
  const atual = await visitorIdFromCookies();
  const id = atual ?? randomUUID();
  // Renova a validade a cada toque.
  (await cookies()).set(VISITOR_COOKIE, id, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: VISITOR_TTL_SECONDS
  });
  return id;
}

export async function recordTouch(
  input: TouchInput,
  hostProprio: string | null,
  userId: string | null
): Promise<{ recorded: boolean; canal?: string }> {
  if (!temParametroDeCampanha(input)) return { recorded: false };

  const visitorId = await garantirVisitorId();
  const referrerHost = hostDoReferrer(input.referrer, hostProprio);
  const canal = canalDoToque(input, referrerHost);

  const result = await query(
    `INSERT INTO marketing_touches (
        visitor_id, user_id, origem_canal, utm_source, utm_medium, utm_campaign,
        utm_content, utm_term, fbclid, gclid, ad_id, adset_id, campaign_id,
        landing_path, referrer_host)
     -- Casts explícitos: cada parâmetro aparece no SELECT e no NOT EXISTS, e
     -- sem tipo declarado o Postgres deduz tipos diferentes e recusa a query.
     SELECT $1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::varchar, $6::varchar,
            $7::varchar, $8::varchar, $9::varchar, $10::varchar, $11::varchar,
            $12::varchar, $13::varchar, $14::varchar, $15::varchar
     WHERE NOT EXISTS (
        SELECT 1 FROM marketing_touches
         WHERE visitor_id = $1::uuid
           AND created_at > now() - ($16 || ' minutes')::interval
           AND utm_source IS NOT DISTINCT FROM $4::varchar
           AND utm_campaign IS NOT DISTINCT FROM $6::varchar
           AND utm_content IS NOT DISTINCT FROM $7::varchar
           AND ad_id IS NOT DISTINCT FROM $11::varchar
           AND fbclid IS NOT DISTINCT FROM $9::varchar)
     RETURNING id`,
    [
      visitorId,
      userId,
      canal,
      input.utm_source ?? null,
      input.utm_medium ?? null,
      input.utm_campaign ?? null,
      input.utm_content ?? null,
      input.utm_term ?? null,
      input.fbclid ?? null,
      input.gclid ?? null,
      input.ad_id ?? null,
      input.adset_id ?? null,
      input.campaign_id ?? null,
      input.landing_path ?? null,
      referrerHost,
      String(DEDUPE_MINUTOS)
    ]
  );
  return { recorded: Boolean(result.rowCount), canal };
}

/**
 * Amarra os toques anônimos do visitante à conta criada. Sem isso, quem clica
 * no anúncio no celular e reserva logado depois perderia a origem assim que o
 * cookie mudasse.
 */
export async function linkVisitorToUser(visitorId: string | null, userId: string) {
  if (!visitorId) return;
  try {
    await query(
      `UPDATE marketing_touches SET user_id = $2
        WHERE visitor_id = $1 AND user_id IS NULL`,
      [visitorId, userId]
    );
  } catch (error) {
    // Atribuição é acessória: não pode recusar um cadastro.
    console.error('[attribution] falha ao vincular visitante', error);
  }
}

/**
 * Preenche a origem do lead com os toques do visitante e/ou do usuário.
 *
 * Só escreve em lead ainda não atribuído: um lead que chegou por Direct ou
 * click-to-WhatsApp já sabe de qual anúncio veio, e uma visita posterior ao
 * site não deve apagar isso.
 */
export async function attributeLead(
  leadId: string,
  who: { visitorId: string | null; userId: string | null },
  client?: PoolClient
) {
  const runner = client ? client.query.bind(client) : query;
  if (!who.visitorId && !who.userId) {
    await runner(
      `UPDATE crm_leads SET origem_canal = COALESCE(origem_canal, 'SITE') WHERE id = $1`,
      [leadId]
    );
    return null;
  }

  const toques = await runner(
    `WITH candidatos AS (
       SELECT * FROM marketing_touches
        WHERE (visitor_id = $1::uuid OR user_id = $2::uuid)
          AND created_at > now() - ($3 || ' days')::interval
     )
     SELECT
       (SELECT id FROM candidatos ORDER BY created_at ASC LIMIT 1) AS primeiro,
       (SELECT id FROM candidatos ORDER BY created_at DESC LIMIT 1) AS ultimo`,
    [who.visitorId, who.userId, String(JANELA_DE_ATRIBUICAO_DIAS)]
  );
  const { primeiro, ultimo } = (toques.rows[0] ?? {}) as { primeiro?: string; ultimo?: string };

  if (!ultimo) {
    await runner(
      `UPDATE crm_leads SET origem_canal = COALESCE(origem_canal, 'SITE') WHERE id = $1`,
      [leadId]
    );
    return null;
  }

  await runner(
    `UPDATE crm_leads l SET
        origem_canal = t.origem_canal,
        utm_source = t.utm_source, utm_medium = t.utm_medium,
        utm_campaign = t.utm_campaign, utm_content = t.utm_content, utm_term = t.utm_term,
        fbclid = t.fbclid, ad_id = t.ad_id, adset_id = t.adset_id, campaign_id = t.campaign_id,
        first_touch_id = $2, last_touch_id = t.id, atribuido_em = now(), updated_at = now()
       FROM marketing_touches t
      WHERE l.id = $1 AND t.id = $3 AND l.atribuido_em IS NULL`,
    [leadId, primeiro ?? ultimo, ultimo]
  );
  return ultimo;
}
