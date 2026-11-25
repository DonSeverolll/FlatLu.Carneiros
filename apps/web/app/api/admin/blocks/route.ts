import { requireFerramenta } from '@/server/acesso';
import { blockListSchema, listCalendarEntries } from '@/server/adminBlocks';
import { handle, json, parseQuery } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bloqueios e períodos especiais de todos os espaços, para a Agenda. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireFerramenta('menu', 'agenda');
    return json(await listCalendarEntries(parseQuery(request, blockListSchema)));
  });
}
