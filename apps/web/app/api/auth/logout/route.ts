import { revokeCurrentSession } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await revokeCurrentSession();
    return json({ ok: true });
  });
}
