import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { PASSO_IDS, marcarPasso } from '@/server/seo/painel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ passo: z.enum(PASSO_IDS), feito: z.boolean() });

/** Marca ou desmarca um passo de SEO feito fora do site (Search Console etc.). */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const input = await parseBody(request, schema);
    await marcarPasso(input.passo, input.feito, session.id);
    return json({ ok: true });
  });
}
