import { startSession } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { requestContext } from '@/server/request';
import { LOGIN_POLICY, assertWithinLimit, recordAttempt } from '@/server/throttle';
import { authenticate, loginSchema } from '@/server/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const context = requestContext(request);
    const input = await parseBody(request, loginSchema);

    // Dois limites: por identidade (protege a conta) e por IP (protege a base).
    await assertWithinLimit('login:identity', input.identifier, LOGIN_POLICY);
    await assertWithinLimit('login:ip', context.ip ?? 'unknown', {
      maxAttempts: 30,
      windowSeconds: 900
    });

    try {
      const user = await authenticate(input);
      await startSession(user.id, user.role, context);
      await recordAttempt('login:identity', input.identifier, true);
      await recordAttempt('login:ip', context.ip ?? 'unknown', true);
      return json({ user });
    } catch (error) {
      await recordAttempt('login:identity', input.identifier, false);
      await recordAttempt('login:ip', context.ip ?? 'unknown', false);
      throw error;
    }
  });
}
