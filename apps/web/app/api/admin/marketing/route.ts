import { requireAdmin } from '@/server/auth';
import { handle, json, parseQuery } from '@/server/http';
import { relatorioAnuncios, relatorioSchema } from '@/server/meta/ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Gasto por anúncio (Meta) cruzado com leads e reservas (nosso banco). */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    return json(await relatorioAnuncios(parseQuery(request, relatorioSchema)));
  });
}
