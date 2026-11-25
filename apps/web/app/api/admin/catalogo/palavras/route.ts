import { requireFerramenta } from '@/server/acesso';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { atualizarPalavras, palavrasSchema } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Palavras da legenda que identificam um espaço. */
export async function PUT(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireFerramenta('catalogo');
    return json(await atualizarPalavras(await parseBody(request, palavrasSchema)));
  });
}
