import { after } from 'next/server';
import { requireAdmin } from '@/server/auth';
import { responderPendentes } from '@/server/agente/agente';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { assertSimulado } from '@/server/atendimento/inbox';
import { simular, simularSchema } from '@/server/atendimento/simulador';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// O agente de IA responde em `after()`, dentro deste limite (espera + chamada ao modelo).
export const maxDuration = 60;

/** Só existe com WHATSAPP_PROVIDER=simulado; em produção real responde 409. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    await assertSimulado();
    const input = await parseBody(request, simularSchema);
    const { resumo, conversasComEntrada } = await simular(input);
    // Igual ao webhook real: o agente avalia depois de responder.
    if (conversasComEntrada.length) after(() => responderPendentes(conversasComEntrada));
    return json(resumo);
  });
}
