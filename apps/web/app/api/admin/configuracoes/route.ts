import { requireAdmin } from '@/server/auth';
import { handle, json } from '@/server/http';
import { diagnostico } from '@/server/configuracoes/diagnostico';
import { descreverIntegracoes } from '@/server/integracoes/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tudo que a tela de Configurações precisa: diagnóstico + integrações. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const origem = new URL(request.url).origin;
    const [grupos, integracoes] = await Promise.all([diagnostico(), descreverIntegracoes()]);
    return json({
      grupos,
      ...integracoes,
      webhooks: {
        whatsapp: `${origem}/api/webhooks/whatsapp`,
        instagram: `${origem}/api/webhooks/instagram`
      }
    });
  });
}
