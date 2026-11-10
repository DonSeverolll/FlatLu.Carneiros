import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';
import { classificarComIA } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Analisa até 6 fotos sem espaço com o Claude e grava a SUGESTÃO. Consome
 * créditos da chave do Agente de IA; nada é publicado sem revisão.
 */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    return json(await classificarComIA());
  });
}
