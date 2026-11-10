import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query } from '../db';
import { notFound } from '../errors';
import { eventosWhatsApp } from './payloads';
import { processarEventos } from './inbox';

/**
 * Simulador do WhatsApp (WHATSAPP_PROVIDER=simulado).
 *
 * Monta um payload NO FORMATO DA CLOUD API e o passa pelo mesmo tradutor e
 * pelo mesmo processamento do webhook real. Assim a simulação exercita o
 * caminho de produção inteiro — idempotência, vínculo com lead, contador de
 * não lidas, janela de 24h — e não um atalho que só existe no teste.
 */

export const simularSchema = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('mensagem'),
    /** Número com DDI e DDD, só dígitos ou formatado. */
    telefone: z.string().trim().min(10).max(20),
    nome: z.string().trim().max(160).optional(),
    texto: z.string().trim().min(1).max(4096),
    /** Simula click-to-WhatsApp: conversa vinda deste anúncio. */
    adId: z.string().regex(/^\d{5,25}$/).optional(),
    anuncioTitulo: z.string().trim().max(200).optional()
  }),
  z.object({
    acao: z.literal('status'),
    mensagemId: z.string().uuid(),
    status: z.enum(['sent', 'delivered', 'read', 'failed'])
  })
]);

function envelope(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'SIMULADO', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', ...value } }] }]
  };
}

export async function simular(input: z.infer<typeof simularSchema>) {
  const agora = Math.floor(Date.now() / 1000).toString();

  if (input.acao === 'mensagem') {
    const waId = input.telefone.replace(/\D/g, '');
    const telefone = waId.length <= 11 ? `55${waId}` : waId;
    const mensagem: Record<string, unknown> = {
      from: telefone,
      id: `wamid.SIM.${randomUUID()}`,
      timestamp: agora,
      type: 'text',
      text: { body: input.texto }
    };
    if (input.adId) {
      mensagem.referral = {
        source_type: 'ad',
        source_id: input.adId,
        source_url: 'https://fb.me/simulado',
        headline: input.anuncioTitulo ?? 'Anúncio simulado',
        ctwa_clid: `SIM${randomUUID().replace(/-/g, '')}`
      };
    }
    // Sem nome informado, o contato vai sem perfil: inventar um nome
    // sobrescreveria o que a conversa já tem.
    const payload = envelope({
      contacts: [input.nome ? { wa_id: telefone, profile: { name: input.nome } } : { wa_id: telefone }],
      messages: [mensagem]
    });
    return processarEventos(eventosWhatsApp(payload));
  }

  const alvo = (
    await query<{ id_externo: string | null; contato: string }>(
      `SELECT m.id_externo, c.contato_externo_id AS contato
         FROM mensagens_whatsapp m JOIN conversas_whatsapp c ON c.id = m.conversa_id
        WHERE m.id = $1 AND m.direcao = 'SAIDA' AND m.canal = 'WHATSAPP'`,
      [input.mensagemId]
    )
  ).rows[0];
  if (!alvo?.id_externo) throw notFound('MESSAGE_NOT_FOUND');

  const status: Record<string, unknown> = {
    id: alvo.id_externo,
    status: input.status,
    timestamp: agora,
    recipient_id: alvo.contato
  };
  if (input.status === 'failed') {
    status.errors = [{ code: 131026, title: 'Message undeliverable (simulado)' }];
  }
  return processarEventos(eventosWhatsApp(envelope({ statuses: [status] })));
}
