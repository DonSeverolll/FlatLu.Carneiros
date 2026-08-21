import { startSession } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { requestContext } from '@/server/request';
import { REGISTER_POLICY, assertWithinLimit, recordAttempt } from '@/server/throttle';
import { registerSchema, registerUser } from '@/server/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const context = requestContext(request);
    await assertWithinLimit('register', context.ip ?? 'unknown', REGISTER_POLICY);

    const input = await parseBody(request, registerSchema);
    try {
      const user = await registerUser(input);
      await startSession(user.id, user.role, context);
      await recordAttempt('register', context.ip ?? 'unknown', true);
      return json({ user }, 201);
    } catch (error) {
      await recordAttempt('register', context.ip ?? 'unknown', false);
      throw error;
    }
  });
}
