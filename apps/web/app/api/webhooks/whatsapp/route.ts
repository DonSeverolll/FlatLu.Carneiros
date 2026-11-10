import { eventosWhatsApp } from '@/server/atendimento/payloads';
import { respostaDeVerificacao } from '@/server/meta/graph';
import { receberWebhookMeta } from '@/server/meta/webhook';
import { handle } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// O agente de IA responde em `after()`, dentro deste limite (espera + chamada ao modelo).
export const maxDuration = 60;

/**
 * Webhook da WhatsApp Cloud API.
 *
 * GET  — handshake de verificação feito pela Meta ao cadastrar a URL.
 * POST — mensagens recebidas e atualizações de status (enviada, entregue,
 *        lida, falhou) das mensagens que o painel enviou.
 *
 * O ENVIO não passa por aqui: sai de `POST /api/admin/atendimento/conversas/:id/mensagens`,
 * que exige sessão de administrador. Misturar as duas coisas na mesma rota
 * obrigaria esta URL pública a aceitar dois tipos de autenticação.
 */
export async function GET(request: Request) {
  return handle(() => respostaDeVerificacao(request));
}

export async function POST(request: Request) {
  return receberWebhookMeta(request, eventosWhatsApp);
}
