import { requireFerramenta } from '@/server/acesso';
import { agenda, agendaSchema } from '@/server/admin';
import { handle, json, parseQuery } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    await requireFerramenta('agenda', 'clientes');
    const range = parseQuery(request, agendaSchema);
    return json({ reservations: await agenda(range) });
  });
}
