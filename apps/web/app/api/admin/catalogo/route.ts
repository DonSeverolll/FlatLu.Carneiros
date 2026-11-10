import { requireAdmin } from '@/server/auth';
import { handle, json } from '@/server/http';
import { listarCatalogo } from '@/server/catalogo/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return json(await listarCatalogo());
  });
}
