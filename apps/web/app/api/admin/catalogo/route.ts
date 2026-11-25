import { requireFerramenta } from '@/server/acesso';
import { handle, json } from '@/server/http';
import { listarCatalogo } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    await requireFerramenta('catalogo');
    return json(await listarCatalogo());
  });
}
