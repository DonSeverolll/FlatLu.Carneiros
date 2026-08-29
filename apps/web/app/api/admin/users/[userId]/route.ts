import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { updateUser, userUpdateSchema } from '@/server/adminUsers';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ userId: z.string().uuid() });

export async function PATCH(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { userId } = params.parse(await ctx.params);
    const input = await parseBody(request, userUpdateSchema);
    return json({ user: await updateUser(userId, session.id, input) });
  });
}
