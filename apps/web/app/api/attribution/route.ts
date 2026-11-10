import { requireUser } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { recordTouch } from '@/server/marketing/attribution';
import { touchSchema } from '@/server/marketing/attributionRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Registra a chegada com parâmetros de campanha. Público: o visitante ainda
 * não tem conta. `assertSameOrigin` impede que outro site plante toques no
 * cookie de quem passa por ele.
 */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const input = await parseBody(request, touchSchema);
    const userId = await requireUser()
      .then((session) => session.id)
      .catch(() => null);
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    const result = await recordTouch(input, host, userId);
    return json(result, result.recorded ? 201 : 200);
  });
}
