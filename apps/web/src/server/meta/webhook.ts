import { after } from 'next/server';
import { handle, json } from '../http';
import { AppError, unauthorized, badRequest } from '../errors';
import { credMetaApp } from '../integracoes/store';
import { responderPendentes } from '../agente/agente';
import { processarEventos } from '../atendimento/inbox';
import type { Evento } from '../atendimento/payloads';
import { assinaturaValida } from './graph';

/** Teto do corpo: lotes reais da Meta têm poucos KB. */
const MAX_BYTES = 1_000_000;

/**
 * Recebe um webhook da Meta: confere a assinatura sobre o corpo cru, traduz
 * e processa. Sem `assertSameOrigin` — é chamada servidor a servidor; quem
 * autentica é o HMAC com o segredo do app.
 */
export function receberWebhookMeta(request: Request, traduzir: (payload: unknown) => Evento[]) {
  return handle(async () => {
    const tamanho = Number(request.headers.get('content-length') ?? 0);
    if (tamanho > MAX_BYTES) throw badRequest('PAYLOAD_TOO_LARGE');

    const corpo = await request.text();
    if (corpo.length > MAX_BYTES) throw badRequest('PAYLOAD_TOO_LARGE');
    const { appSecret } = await credMetaApp();
    if (!appSecret) throw new AppError(503, 'MESSAGING_NOT_CONFIGURED', { detalhe: 'META_APP_SECRET' });
    if (!assinaturaValida(corpo, request.headers.get('x-hub-signature-256'), appSecret)) {
      throw unauthorized('INVALID_WEBHOOK_SIGNATURE');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(corpo);
    } catch {
      throw badRequest('INVALID_JSON');
    }

    const { resumo, conversasComEntrada } = await processarEventos(traduzir(payload));
    // O agente de IA responde DEPOIS do 200: a Meta reenvia o webhook se a
    // resposta demorar, e uma chamada ao modelo leva segundos.
    if (conversasComEntrada.length) after(() => responderPendentes(conversasComEntrada));
    return json({ received: true, ...resumo });
  });
}
