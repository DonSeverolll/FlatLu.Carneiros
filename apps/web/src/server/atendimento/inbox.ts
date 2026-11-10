import { z } from 'zod';
import type { PoolClient } from 'pg';
import { query, transaction } from '../db';
import { AppError, badRequest, conflict, notFound } from '../errors';
import { addActivity } from '../crm';
import { enviar, instagramConfigurado, modoWhatsApp, notConfigured } from './gateway';
import { graph } from '../meta/graph';
import { configAgente, credInstagram } from '../integracoes/store';
import {
  previa,
  proximoStatus,
  type Evento,
  type EventoMensagem,
  type EventoStatus,
  type StatusMensagem,
  type TipoMensagem
} from './payloads';

/**
 * Central de Atendimento: WhatsApp e Instagram Direct no mesmo inbox.
 *
 * Três garantias que a tela assume:
 * 1. Idempotência. A Meta reenvia webhook até receber 200 e às vezes reenvia
 *    mesmo assim. O índice único (canal, id_externo) faz o segundo INSERT não
 *    fazer nada — nem contar não lida de novo.
 * 2. Status monotônico. "Lida" que chega antes de "entregue" não regride.
 * 3. Todo contato vira lead. Quem escreve sem ter card no CRM ganha um, já
 *    com o anúncio de origem quando a conversa veio de click-to-WhatsApp/Direct.
 */

const JANELA_HORAS = 24;

// ---------------------------------------------------------------------------
// Entrada (webhook)
// ---------------------------------------------------------------------------

/**
 * `conversasComEntrada`: conversas que receberam mensagem NOVA do cliente
 * neste lote — é a lista que o agente de IA avalia depois de responder 200.
 */
export async function processarEventos(eventos: Evento[]) {
  const resumo = { mensagens: 0, duplicadas: 0, status: 0, ignorados: 0 };
  const conversasComEntrada = new Set<string>();
  for (const evento of eventos) {
    try {
      if (evento.evento === 'mensagem') {
        const r = await registrarMensagem(evento);
        if (r.inserida) resumo.mensagens += 1;
        else resumo.duplicadas += 1;
        if (r.inserida && evento.direcao === 'ENTRADA') conversasComEntrada.add(r.conversaId);
      } else {
        const alterou = await aplicarStatus(evento);
        if (alterou) resumo.status += 1;
        else resumo.ignorados += 1;
      }
    } catch (error) {
      // Um item ruim não pode fazer a Meta reenviar o lote inteiro.
      resumo.ignorados += 1;
      console.error('[atendimento] evento descartado', evento.evento, evento.idExterno, error);
    }
  }
  return { resumo, conversasComEntrada: [...conversasComEntrada] };
}

function nomeProvisorio(e: EventoMensagem): string {
  if (e.contatoNome) return e.contatoNome;
  if (e.telefone) return `+${e.telefone}`;
  return e.canal === 'INSTAGRAM' ? 'Contato do Instagram' : 'Contato do WhatsApp';
}

async function vincularLead(
  client: PoolClient,
  conversaId: string,
  e: EventoMensagem
): Promise<{ leadId: string; reservaId: string | null }> {
  let lead: { id: string; reservation_id: string | null; customer_id: string | null } | undefined;

  if (e.telefone) {
    lead = (
      await client.query(
        `SELECT id, reservation_id, customer_id FROM crm_leads
          WHERE phone IS NOT NULL AND telefone_chave(phone) = telefone_chave($1)
          ORDER BY (archived_at IS NULL) DESC, (stage NOT IN ('WON','LOST')) DESC, updated_at DESC
          LIMIT 1`,
        [e.telefone]
      )
    ).rows[0];

    if (!lead) {
      // Hóspede cadastrado sem card ainda: o card nasce já ligado à conta.
      const usuario = (
        await client.query(
          `SELECT id FROM users
            WHERE phone IS NOT NULL AND deleted_at IS NULL
              AND telefone_chave(phone) = telefone_chave($1)
            ORDER BY created_at DESC LIMIT 1`,
          [e.telefone]
        )
      ).rows[0] as { id: string } | undefined;
      if (usuario) {
        lead = (
          await client.query(
            `SELECT id, reservation_id, customer_id FROM crm_leads
              WHERE customer_id = $1
              ORDER BY (archived_at IS NULL) DESC, (stage NOT IN ('WON','LOST')) DESC, updated_at DESC
              LIMIT 1`,
            [usuario.id]
          )
        ).rows[0];
        lead ??= { id: '', reservation_id: null, customer_id: usuario.id };
      }
    }
  }

  const adId = e.referral?.adId ?? null;
  let leadId = lead?.id || null;

  if (!leadId) {
    const criado = await client.query<{ id: string }>(
      `INSERT INTO crm_leads (name, phone, customer_id, stage, source, origem_canal,
                              ad_id, adset_id, campaign_id, ctwa_clid, atribuido_em,
                              next_action, next_action_at)
       VALUES ($1, $2, $3, 'NEW', $4, $5, $6::varchar,
               (SELECT adset_id FROM meta_ads WHERE ad_id = $6::varchar),
               (SELECT campaign_id FROM meta_ads WHERE ad_id = $6::varchar),
               $7, CASE WHEN $6::varchar IS NOT NULL THEN now() END,
               'Responder a mensagem', now())
       RETURNING id`,
      [
        nomeProvisorio(e),
        e.telefone ? `+${e.telefone}` : null,
        lead?.customer_id ?? null,
        e.canal,
        adId ? 'META_ADS' : e.canal,
        adId,
        e.referral?.ctwaClid ?? null
      ]
    );
    leadId = criado.rows[0]!.id;
    const canal = e.canal === 'INSTAGRAM' ? 'no Instagram Direct' : 'no WhatsApp';
    const anuncio = e.referral?.headline ?? adId;
    await addActivity(
      leadId,
      null,
      {
        kind: 'WHATSAPP',
        body: `Card aberto por mensagem ${canal}${anuncio ? ` vinda do anúncio "${anuncio}"` : ''}.`
      },
      client
    );
  } else if (adId) {
    // Lead conhecido que voltou por um anúncio: só atribui se ainda não tinha origem.
    await client.query(
      `UPDATE crm_leads SET origem_canal = 'META_ADS', ad_id = $2,
              adset_id = (SELECT adset_id FROM meta_ads WHERE ad_id = $2),
              campaign_id = (SELECT campaign_id FROM meta_ads WHERE ad_id = $2),
              ctwa_clid = $3, atribuido_em = now(), updated_at = now()
        WHERE id = $1 AND atribuido_em IS NULL`,
      [leadId, adId, e.referral?.ctwaClid ?? null]
    );
  }

  const reserva = (
    await client.query<{ id: string }>(
      `SELECT COALESCE(
          (SELECT reservation_id FROM crm_leads WHERE id = $1),
          (SELECT r.id FROM reservations r
             WHERE r.customer_id = (SELECT customer_id FROM crm_leads WHERE id = $1)
               AND r.status IN ('PENDING_PAYMENT', 'CONFIRMED')
             ORDER BY r.check_in DESC LIMIT 1)
        ) AS id`,
      [leadId]
    )
  ).rows[0];

  await client.query(
    `UPDATE conversas_whatsapp SET lead_id = $2, reserva_id = COALESCE(reserva_id, $3), updated_at = now()
      WHERE id = $1`,
    [conversaId, leadId, reserva?.id ?? null]
  );
  return { leadId, reservaId: reserva?.id ?? null };
}

export async function registrarMensagem(e: EventoMensagem): Promise<{ inserida: boolean; conversaId: string }> {
  const resultado = await transaction(async (client) => {
    const conversa = (
      await client.query<{ id: string; lead_id: string | null; reserva_id: string | null; criada: boolean }>(
        `INSERT INTO conversas_whatsapp (canal, contato_externo_id, contato_nome, contato_telefone, referral)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (canal, contato_externo_id) DO UPDATE SET
           contato_nome = COALESCE(EXCLUDED.contato_nome, conversas_whatsapp.contato_nome),
           contato_telefone = COALESCE(conversas_whatsapp.contato_telefone, EXCLUDED.contato_telefone),
           referral = COALESCE(conversas_whatsapp.referral, EXCLUDED.referral)
         RETURNING id, lead_id, reserva_id, (xmax = 0) AS criada`,
        [
          e.canal,
          e.contatoId,
          e.contatoNome,
          e.telefone ? `+${e.telefone}` : null,
          e.referral ? JSON.stringify(e.referral) : null
        ]
      )
    ).rows[0]!;

    let { lead_id: leadId, reserva_id: reservaId } = conversa;
    if (!leadId) {
      const vinculo = await vincularLead(client, conversa.id, e);
      leadId = vinculo.leadId;
      reservaId = reservaId ?? vinculo.reservaId;
    }

    const inserida = await client.query(
      `INSERT INTO mensagens_whatsapp (
          conversa_id, lead_id, reserva_id, canal, direcao, tipo, corpo, midia_url,
          midia_id_provedor, midia_mime, midia_nome_arquivo, status, id_externo,
          enviada_em, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (canal, id_externo) WHERE id_externo IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        conversa.id,
        leadId,
        reservaId,
        e.canal,
        e.direcao,
        e.tipo,
        e.corpo,
        e.midiaUrl,
        e.midiaId,
        e.midiaMime,
        e.midiaNomeArquivo,
        e.direcao === 'ENTRADA' ? 'RECEBIDA' : 'ENVIADA',
        e.idExterno,
        e.em.toISOString(),
        JSON.stringify(e.bruto ?? null)
      ]
    );
    if (!inserida.rowCount) return { inserida: false, conversaId: conversa.id, criada: conversa.criada };

    await client.query(
      `UPDATE conversas_whatsapp SET
          ultima_mensagem_previa = CASE
            WHEN ultima_mensagem_em IS NULL OR $2::timestamptz >= ultima_mensagem_em THEN $3
            ELSE ultima_mensagem_previa END,
          ultima_mensagem_em = GREATEST(COALESCE(ultima_mensagem_em, $2::timestamptz), $2::timestamptz),
          nao_lidas = nao_lidas + CASE WHEN $4::text = 'ENTRADA' THEN 1 ELSE 0 END,
          janela_expira_em = CASE WHEN $4::text = 'ENTRADA'
            THEN GREATEST(COALESCE(janela_expira_em, $2::timestamptz),
                          $2::timestamptz + ($5 || ' hours')::interval)
            ELSE janela_expira_em END,
          status = CASE WHEN $4::text = 'ENTRADA' AND status = 'RESOLVIDA' THEN 'ABERTA' ELSE status END,
          updated_at = now()
        WHERE id = $1`,
      [conversa.id, e.em.toISOString(), previa(e.tipo, e.corpo), e.direcao, String(JANELA_HORAS)]
    );
    return { inserida: true, conversaId: conversa.id, criada: conversa.criada };
  });

  if (resultado.criada && e.canal === 'INSTAGRAM' && e.direcao === 'ENTRADA') {
    await completarPerfilInstagram(resultado.conversaId, e.contatoId);
  }
  return { inserida: resultado.inserida, conversaId: resultado.conversaId };
}

/** O webhook do Direct não traz nome; buscamos uma vez, sem bloquear nada. */
async function completarPerfilInstagram(conversaId: string, igsid: string) {
  const ig = await credInstagram();
  if (!ig.configurado || !ig.pageToken) return;
  try {
    const perfil = await graph<{ name?: string; username?: string }>(igsid, {
      token: ig.pageToken,
      params: { fields: 'name,username' }
    });
    const nome = (perfil.name || (perfil.username ? `@${perfil.username}` : '')).slice(0, 160);
    if (!nome) return;
    await query(
      `UPDATE conversas_whatsapp SET contato_nome = COALESCE(contato_nome, $2) WHERE id = $1`,
      [conversaId, nome]
    );
    await query(
      `UPDATE crm_leads SET name = $2
        WHERE id = (SELECT lead_id FROM conversas_whatsapp WHERE id = $1)
          AND name = 'Contato do Instagram'`,
      [conversaId, nome]
    );
  } catch (error) {
    console.warn('[atendimento] perfil do Instagram indisponível', error);
  }
}

export async function aplicarStatus(e: EventoStatus): Promise<boolean> {
  if (e.ateAqui) {
    // Instagram: "leu tudo até aqui" vale para todas as saídas anteriores.
    const r = await query(
      `UPDATE mensagens_whatsapp m SET status = 'LIDA', lida_em = COALESCE(m.lida_em, $3::timestamptz),
              entregue_em = COALESCE(m.entregue_em, $3::timestamptz), updated_at = now()
         FROM conversas_whatsapp c
        WHERE c.id = m.conversa_id AND c.canal = $1 AND c.contato_externo_id = $2
          AND m.direcao = 'SAIDA' AND m.status IN ('ENVIADA', 'ENTREGUE')
          AND COALESCE(m.enviada_em, m.created_at) <= $3::timestamptz`,
      [e.canal, e.contatoId, e.em.toISOString()]
    );
    return Boolean(r.rowCount);
  }

  return transaction(async (client) => {
    const atual = (
      await client.query<{ id: string; status: StatusMensagem }>(
        `SELECT id, status FROM mensagens_whatsapp
          WHERE canal = $1 AND id_externo = $2 FOR UPDATE`,
        [e.canal, e.idExterno]
      )
    ).rows[0];
    // Mensagem enviada fora do painel (ou antes desta versão): nada a fazer.
    if (!atual) return false;

    const novo = proximoStatus(atual.status, e.status);
    if (novo === atual.status && e.status !== 'FALHOU') return false;

    const em = e.em.toISOString();
    await client.query(
      `UPDATE mensagens_whatsapp SET
          status = $2::varchar,
          enviada_em = COALESCE(enviada_em, $3::timestamptz),
          entregue_em = CASE WHEN $2::varchar IN ('ENTREGUE', 'LIDA')
                             THEN COALESCE(entregue_em, $3::timestamptz) ELSE entregue_em END,
          lida_em = CASE WHEN $2::varchar = 'LIDA' THEN COALESCE(lida_em, $3::timestamptz) ELSE lida_em END,
          erro = CASE WHEN $2::varchar = 'FALHOU' THEN $4::varchar ELSE erro END,
          updated_at = now()
        WHERE id = $1`,
      [atual.id, novo, em, e.erro]
    );
    return true;
  });
}

// ---------------------------------------------------------------------------
// Leitura (painel)
// ---------------------------------------------------------------------------

export const listarSchema = z.object({
  status: z.enum(['ABERTA', 'PENDENTE', 'RESOLVIDA', 'TODAS']).default('ABERTA'),
  canal: z.enum(['WHATSAPP', 'INSTAGRAM']).optional(),
  busca: z.string().trim().max(120).optional(),
  naoLidas: z.enum(['true', 'false']).default('false').transform((v) => v === 'true')
});

const CONVERSA_COLUNAS = `
  c.id, c.canal, c.contato_externo_id, c.contato_nome, c.contato_telefone, c.status,
  c.nao_lidas, c.ultima_mensagem_em, c.ultima_mensagem_previa, c.janela_expira_em,
  c.lead_id, c.reserva_id, c.referral, c.responsavel_id, c.updated_at,
  c.ia_pausada, c.ia_respostas,
  (c.janela_expira_em IS NOT NULL AND c.janela_expira_em > now()) AS janela_aberta,
  l.name AS lead_nome, l.stage::text AS lead_estagio, l.origem_canal,
  COALESCE(p.short_name, p.name) AS unidade, p.color AS unidade_cor,
  resp.full_name AS responsavel`;

const CONVERSA_JOINS = `
  FROM conversas_whatsapp c
  LEFT JOIN crm_leads l ON l.id = c.lead_id
  LEFT JOIN reservations r ON r.id = c.reserva_id
  LEFT JOIN properties p ON p.id = COALESCE(r.property_id, l.property_id)
  LEFT JOIN users resp ON resp.id = c.responsavel_id`;

export async function listarConversas(input: z.infer<typeof listarSchema>) {
  const busca = input.busca ? `%${input.busca.toLowerCase()}%` : null;
  const conversas = await query(
    `SELECT ${CONVERSA_COLUNAS}
     ${CONVERSA_JOINS}
     WHERE ($1::text = 'TODAS' OR c.status = $1)
       AND ($2::text IS NULL OR c.canal = $2)
       AND ($3::text IS NULL OR lower(COALESCE(c.contato_nome, '')) LIKE $3
            OR lower(COALESCE(l.name, '')) LIKE $3
            OR COALESCE(c.contato_telefone, '') LIKE $3
            OR lower(COALESCE(c.ultima_mensagem_previa, '')) LIKE $3)
       AND ($4::boolean IS NOT TRUE OR c.nao_lidas > 0)
     ORDER BY c.ultima_mensagem_em DESC NULLS LAST
     LIMIT 200`,
    [input.status, input.canal ?? null, busca, input.naoLidas]
  );
  const contagem = await query<{ status: string; total: string; nao_lidas: string }>(
    `SELECT status, COUNT(*)::text AS total, COALESCE(SUM(nao_lidas), 0)::text AS nao_lidas
       FROM conversas_whatsapp GROUP BY status`
  );
  return {
    conversas: conversas.rows,
    porStatus: contagem.rows,
    modo: {
      whatsapp: await safeModo(),
      instagram: await instagramConfigurado(),
      agente: (await configAgente()).modo
    }
  };
}

async function safeModo() {
  try {
    return await modoWhatsApp();
  } catch {
    return null;
  }
}

const MENSAGEM_COLUNAS = `
  m.id, m.direcao, m.tipo, m.corpo, m.midia_url, m.midia_mime, m.midia_nome_arquivo,
  (m.midia_id_provedor IS NOT NULL AND m.midia_id_provedor NOT LIKE 'sim-%') AS midia_baixavel,
  m.status, m.erro, m.created_at, m.updated_at, m.enviada_em, m.entregue_em, m.lida_em,
  m.gerada_por_ia,
  COALESCE(m.enviada_em, m.created_at) AS em, u.full_name AS autor`;

async function carregarConversa(conversaId: string) {
  const r = await query(`SELECT ${CONVERSA_COLUNAS} ${CONVERSA_JOINS} WHERE c.id = $1`, [conversaId]);
  if (!r.rowCount) throw notFound('CONVERSATION_NOT_FOUND');
  return r.rows[0]!;
}

export async function detalheConversa(conversaId: string) {
  const conversa = await carregarConversa(conversaId);

  const mensagens = await query(
    `SELECT * FROM (
        SELECT ${MENSAGEM_COLUNAS}
          FROM mensagens_whatsapp m LEFT JOIN users u ON u.id = m.autor_id
         WHERE m.conversa_id = $1
         ORDER BY COALESCE(m.enviada_em, m.created_at) DESC
         LIMIT 80) ultimas
     ORDER BY em ASC`,
    [conversaId]
  );

  const lead = conversa.lead_id
    ? (
        await query(
          `SELECT l.id, l.name, l.email, l.phone, l.stage::text AS stage, l.source,
                  l.origem_canal, l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content,
                  l.ad_id, l.adset_id, l.campaign_id, l.atribuido_em, l.next_action, l.next_action_at,
                  a.ad_name, a.adset_name, a.campaign_name
             FROM crm_leads l LEFT JOIN meta_ads a ON a.ad_id = l.ad_id
            WHERE l.id = $1`,
          [conversa.lead_id]
        )
      ).rows[0] ?? null
    : null;

  const reserva = conversa.reserva_id
    ? (
        await query(
          `SELECT r.id, r.check_in::text AS check_in, r.check_out::text AS check_out,
                  r.status::text AS status, r.payment_status::text AS payment_status,
                  r.total_amount, r.deposit_amount, r.guest_count,
                  COALESCE(p.short_name, p.name) AS unidade, p.color AS unidade_cor,
                  EXISTS (SELECT 1 FROM contracts ct
                           WHERE ct.reservation_id = r.id AND ct.status = 'SIGNED') AS contrato_assinado
             FROM reservations r JOIN properties p ON p.id = r.property_id
            WHERE r.id = $1`,
          [conversa.reserva_id]
        )
      ).rows[0] ?? null
    : null;

  const cursor = await cursorAgora();
  return { conversa, mensagens: mensagens.rows, lead, reserva, cursor };
}

/**
 * Cursor de polling com folga de 5 s: uma transação que começou antes do
 * `now()` e confirmou depois teria `updated_at` anterior ao cursor e sumiria.
 * A folga devolve algumas linhas repetidas, que a tela junta por id.
 */
async function cursorAgora(): Promise<string> {
  // Relógio do BANCO (é com ele que `updated_at` é gravado), devolvido em ISO
  // 8601: o texto nativo do Postgres ("2026-11-10 11:40:00-03") não passa na
  // validação do `?desde=`.
  const r = await query<{ cursor: Date }>(`SELECT now() - interval '5 seconds' AS cursor`);
  return r.rows[0]!.cursor.toISOString();
}

export const mudancasSchema = z.object({ desde: z.string().datetime({ offset: true }) });

export async function mudancasConversa(conversaId: string, desde: string) {
  const conversa = await carregarConversa(conversaId);
  const mensagens = await query(
    `SELECT ${MENSAGEM_COLUNAS}
       FROM mensagens_whatsapp m LEFT JOIN users u ON u.id = m.autor_id
      WHERE m.conversa_id = $1 AND m.updated_at > $2
      ORDER BY COALESCE(m.enviada_em, m.created_at) ASC
      LIMIT 200`,
    [conversaId, desde]
  );
  return { conversa, mensagens: mensagens.rows, cursor: await cursorAgora() };
}

// ---------------------------------------------------------------------------
// Ações do atendente
// ---------------------------------------------------------------------------

export const atualizarSchema = z
  .object({
    status: z.enum(['ABERTA', 'PENDENTE', 'RESOLVIDA']).optional(),
    responsavelId: z.string().uuid().nullable().optional(),
    leadId: z.string().uuid().optional(),
    reservaId: z.string().uuid().nullable().optional(),
    /** Pausa/retoma o agente de IA nesta conversa. */
    iaPausada: z.boolean().optional()
  })
  .strict();

export async function atualizarConversa(conversaId: string, input: z.infer<typeof atualizarSchema>) {
  const campos: string[] = [];
  const valores: unknown[] = [conversaId];
  const set = (coluna: string, valor: unknown) => {
    valores.push(valor);
    campos.push(`${coluna} = $${valores.length}`);
  };
  if (input.status) set('status', input.status);
  if (input.responsavelId !== undefined) set('responsavel_id', input.responsavelId);
  if (input.leadId) set('lead_id', input.leadId);
  if (input.reservaId !== undefined) set('reserva_id', input.reservaId);
  if (input.iaPausada !== undefined) set('ia_pausada', input.iaPausada);
  if (!campos.length) throw badRequest('NO_FIELDS_TO_UPDATE');

  const r = await query(
    `UPDATE conversas_whatsapp SET ${campos.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`,
    valores
  );
  if (!r.rowCount) throw notFound('CONVERSATION_NOT_FOUND');
  return carregarConversa(conversaId);
}

export async function marcarLida(conversaId: string) {
  await query(`UPDATE conversas_whatsapp SET nao_lidas = 0 WHERE id = $1 AND nao_lidas > 0`, [conversaId]);
}

const httpsUrl = z
  .string()
  .url()
  .max(2000)
  .refine((u) => u.startsWith('https://'), 'A mídia precisa estar em https://');

export const enviarSchema = z
  .object({
    tipo: z.enum(['TEXTO', 'IMAGEM', 'VIDEO', 'PDF', 'DOCUMENTO', 'AUDIO', 'TEMPLATE']).default('TEXTO'),
    corpo: z.string().trim().max(4096).optional(),
    midiaUrl: httpsUrl.optional(),
    midiaId: z.string().trim().max(160).optional(),
    midiaNomeArquivo: z.string().trim().max(240).optional(),
    midiaMime: z.string().trim().max(120).optional(),
    template: z
      .object({
        nome: z.string().trim().regex(/^[a-z0-9_]{1,512}$/),
        idioma: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('pt_BR')
      })
      .optional()
  })
  .superRefine((v, ctx) => {
    if (v.tipo === 'TEXTO' && !v.corpo) ctx.addIssue({ code: 'custom', message: 'Texto vazio', path: ['corpo'] });
    if (v.tipo === 'TEMPLATE' && !v.template)
      ctx.addIssue({ code: 'custom', message: 'Informe o modelo', path: ['template'] });
    if (!['TEXTO', 'TEMPLATE'].includes(v.tipo) && !v.midiaUrl && !v.midiaId)
      ctx.addIssue({ code: 'custom', message: 'Anexe um arquivo ou informe a URL', path: ['midiaUrl'] });
  });

/**
 * @param autorId atendente que enviou; `null` quando quem respondeu foi o
 * agente de IA (`opcoes.ia`). Resposta humana pausa o agente na conversa:
 * quem assumiu o atendimento não quer o robô falando por cima.
 */
export async function enviarMensagem(
  conversaId: string,
  autorId: string | null,
  input: z.infer<typeof enviarSchema>,
  /**
   * `contaComoContato: false` — mensagem que não é atendimento de fato (o
   * aviso automático de transferência): não tira o lead de "Novo", senão o
   * card sumiria da fila justo quando a equipe precisa agir.
   */
  opcoes: { ia?: boolean; contaComoContato?: boolean } = {}
) {
  const ia = Boolean(opcoes.ia);
  const contaComoContato = opcoes.contaComoContato ?? true;
  const conversa = await carregarConversa(conversaId);
  const canal = conversa.canal as 'WHATSAPP' | 'INSTAGRAM';

  // Configuração ANTES de gravar: uma mensagem que nunca teve como sair não
  // deve aparecer no histórico como "falhou".
  if (canal === 'WHATSAPP' && !(await safeModo())) throw notConfigured('WHATSAPP_PROVIDER');
  if (canal === 'INSTAGRAM' && input.tipo === 'TEMPLATE') throw badRequest('TEMPLATE_WHATSAPP_ONLY');

  /*
   * Fora da janela de 24h, WhatsApp e Instagram recusam texto livre. Barrar
   * aqui dá ao atendente o motivo certo ("use um modelo") em vez do código de
   * erro genérico que a Meta devolveria depois.
   */
  if (!conversa.janela_aberta && input.tipo !== 'TEMPLATE') {
    throw new AppError(409, 'WINDOW_CLOSED', { canal });
  }

  const tipo = input.tipo as TipoMensagem;
  const corpo = tipo === 'TEMPLATE' ? `Modelo: ${input.template!.nome}` : (input.corpo ?? null);

  const pendente = await query<{ id: string }>(
    `INSERT INTO mensagens_whatsapp (
        conversa_id, lead_id, reserva_id, canal, direcao, tipo, corpo, midia_url,
        midia_id_provedor, midia_mime, midia_nome_arquivo, status, autor_id, gerada_por_ia)
     VALUES ($1, $2, $3, $4, 'SAIDA', $5, $6, $7, $8, $9, $10, 'PENDENTE', $11, $12)
     RETURNING id`,
    [
      conversaId,
      conversa.lead_id,
      conversa.reserva_id,
      canal,
      tipo,
      corpo,
      input.midiaUrl ?? null,
      input.midiaId ?? null,
      input.midiaMime ?? null,
      input.midiaNomeArquivo ?? null,
      autorId,
      ia
    ]
  );
  let mensagemId = pendente.rows[0]!.id;

  let falha: AppError | null = null;
  try {
    const envio = await enviar({
      canal,
      para: conversa.contato_externo_id as string,
      tipo,
      corpo: input.corpo ?? null,
      midiaUrl: input.midiaUrl ?? null,
      midiaId: input.midiaId ?? null,
      midiaNomeArquivo: input.midiaNomeArquivo ?? null,
      template: input.template ?? null
    });
    mensagemId = await confirmarEnvio(mensagemId, canal, envio.idExterno, autorId);
  } catch (error) {
    falha =
      error instanceof AppError ? error : new AppError(502, 'MESSAGE_SEND_FAILED');
    const detalhe = (falha.details as { message?: string } | undefined)?.message;
    await query(
      `UPDATE mensagens_whatsapp SET status = 'FALHOU', erro = $2, updated_at = now() WHERE id = $1`,
      [mensagemId, `${falha.code}${detalhe ? `: ${detalhe}` : ''}`.slice(0, 500)]
    );
    if (!(error instanceof AppError)) console.error('[atendimento] envio falhou', error);
  }

  await query(
    `UPDATE conversas_whatsapp SET ultima_mensagem_em = now(), ultima_mensagem_previa = $2,
            nao_lidas = CASE WHEN $3::boolean THEN nao_lidas ELSE 0 END,
            ia_pausada = CASE WHEN $3::boolean THEN ia_pausada ELSE true END,
            ia_respostas = ia_respostas + CASE WHEN $3::boolean THEN 1 ELSE 0 END,
            updated_at = now()
      WHERE id = $1`,
    [conversaId, previa(tipo, corpo), ia]
  );

  // Primeira resposta tira o lead de "Novo": o funil acompanha o atendimento.
  if (!falha && conversa.lead_id && contaComoContato) {
    const movido = await query(
      `UPDATE crm_leads SET stage = 'CONTACTED', updated_at = now()
        WHERE id = $1 AND stage = 'NEW' RETURNING id`,
      [conversa.lead_id]
    );
    if (movido.rowCount) {
      await addActivity(conversa.lead_id as string, autorId, {
        kind: 'WHATSAPP',
        body: `Primeira resposta enviada pelo ${canal === 'INSTAGRAM' ? 'Instagram Direct' : 'WhatsApp'}${ia ? ' (agente de IA)' : ''}.`
      });
    }
  }

  const mensagem = (
    await query(
      `SELECT ${MENSAGEM_COLUNAS} FROM mensagens_whatsapp m LEFT JOIN users u ON u.id = m.autor_id
        WHERE m.id = $1`,
      [mensagemId]
    )
  ).rows[0];
  return { mensagem, erro: falha ? falha.code : null };
}

/**
 * Grava o id do provedor na mensagem pendente.
 *
 * O Instagram devolve o eco da nossa própria mensagem pelo webhook, e ele pode
 * chegar ANTES desta linha rodar — nesse caso o webhook já gravou a mensagem
 * com o mesmo id e o índice único recusaria o segundo. A linha do eco fica
 * (recebe o autor) e a pendente sai, em vez de marcar como falha algo que foi
 * entregue.
 */
async function confirmarEnvio(mensagemId: string, canal: string, idExterno: string, autorId: string | null) {
  try {
    await query(
      `UPDATE mensagens_whatsapp SET status = 'ENVIADA', id_externo = $2, enviada_em = now(), updated_at = now()
        WHERE id = $1 AND status = 'PENDENTE'`,
      [mensagemId, idExterno]
    );
    return mensagemId;
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
    return transaction(async (client) => {
      const eco = await client.query<{ id: string }>(
        `UPDATE mensagens_whatsapp SET autor_id = COALESCE(autor_id, $3), updated_at = now()
          WHERE canal = $1 AND id_externo = $2 RETURNING id`,
        [canal, idExterno, autorId]
      );
      await client.query(`DELETE FROM mensagens_whatsapp WHERE id = $1`, [mensagemId]);
      return eco.rows[0]?.id ?? mensagemId;
    });
  }
}

export const iniciarSchema = z.object({ leadId: z.string().uuid() });

/**
 * Abre conversa de WhatsApp a partir de um lead do CRM. A janela começa
 * fechada: a primeira mensagem precisa ser um modelo aprovado.
 */
export async function iniciarConversa(leadId: string) {
  const lead = (
    await query<{ id: string; name: string; phone: string | null; reservation_id: string | null }>(
      `SELECT id, name, phone, reservation_id FROM crm_leads WHERE id = $1`,
      [leadId]
    )
  ).rows[0];
  if (!lead) throw notFound('LEAD_NOT_FOUND');
  const waId = waIdDoTelefone(lead.phone);
  if (!waId) throw badRequest('LEAD_WITHOUT_PHONE');

  const conversa = await query<{ id: string }>(
    `INSERT INTO conversas_whatsapp (canal, contato_externo_id, contato_nome, contato_telefone, lead_id, reserva_id)
     VALUES ('WHATSAPP', $1, $2, $3, $4, $5)
     ON CONFLICT (canal, contato_externo_id) DO UPDATE SET
       lead_id = COALESCE(conversas_whatsapp.lead_id, EXCLUDED.lead_id),
       reserva_id = COALESCE(conversas_whatsapp.reserva_id, EXCLUDED.reserva_id),
       status = CASE WHEN conversas_whatsapp.status = 'RESOLVIDA' THEN 'ABERTA' ELSE conversas_whatsapp.status END,
       updated_at = now()
     RETURNING id`,
    [waId, lead.name, `+${waId}`, lead.id, lead.reservation_id]
  );
  return { conversaId: conversa.rows[0]!.id };
}

/** Telefone do cadastro → wa_id (só dígitos, com DDI 55 quando faltar). */
export function waIdDoTelefone(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if (digitos.length >= 12 && digitos.length <= 15) return digitos;
  return null;
}

export async function midiaDaMensagem(mensagemId: string) {
  const r = await query<{ canal: string; midia_id_provedor: string | null; midia_url: string | null }>(
    `SELECT canal, midia_id_provedor, midia_url FROM mensagens_whatsapp WHERE id = $1`,
    [mensagemId]
  );
  const m = r.rows[0];
  if (!m) throw notFound('MESSAGE_NOT_FOUND');
  return m;
}

export async function assertSimulado() {
  if ((await safeModo()) !== 'simulado') throw conflict('SIMULATION_DISABLED');
}
