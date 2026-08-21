import { rotateSession } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';
import { requestContext } from '@/server/request';
import { currentUser } from '@/server/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Renova o access token de 15 minutos usando o refresh token de 30 dias.
 * Sem esta rota, o hóspede era deslogado no meio da reserva.
 */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await rotateSession(requestContext(request));
    return json({ user: await currentUser(session.id) });
  });
}
