import { requireUser } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { updateProfile, updateProfileSchema } from '@/server/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireUser();
    const input = await parseBody(request, updateProfileSchema);
    return json({ user: await updateProfile(session.id, input) });
  });
}
