import { credInstagram } from '@/server/integracoes/store';
import { eventosInstagram } from '@/server/atendimento/payloads';
import { respostaDeVerificacao } from '@/server/meta/graph';
import { receberWebhookMeta } from '@/server/meta/webhook';
import { handle } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// O agente de IA responde em `after()`, dentro deste limite (espera + chamada ao modelo).
export const maxDuration = 60;

/**
 * Webhook do Instagram Messaging (Direct): mensagens recebidas, ecos do que
 * a conta enviou e confirmações de leitura. Mesmo app da Meta, mesmo segredo
 * e mesmo token de verificação do webhook do WhatsApp.
 */
export async function GET(request: Request) {
  return handle(() => respostaDeVerificacao(request));
}

export async function POST(request: Request) {
  const { igAccountId } = await credInstagram();
  return receberWebhookMeta(request, (payload) => eventosInstagram(payload, igAccountId ?? null));
}
