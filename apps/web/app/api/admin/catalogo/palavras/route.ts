import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { atualizarPalavras, palavrasSchema } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Palavras da legenda que identificam um espaço. */
export async function PUT(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    return json(await atualizarPalavras(await parseBody(request, palavrasSchema)));
  });
}
