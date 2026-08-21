import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { REFRESH_COOKIE, requireUser } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { changePassword, changePasswordSchema } from '@/server/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireUser();
    const input = await parseBody(request, changePasswordSchema);

    // A sessão atual sobrevive; as outras caem.
    const store = await cookies();
    const current = store.get(REFRESH_COOKIE)?.value;
    const keep = current ? createHash('sha256').update(current).digest('hex') : undefined;

    return json(await changePassword(session.id, input, keep));
  });
}
