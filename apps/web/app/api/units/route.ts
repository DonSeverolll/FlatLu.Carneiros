import { z } from 'zod';
import { isIsoDate } from '@/server/dates';
import { handle, json, parseQuery } from '@/server/http';
import { unitCalendar } from '@/server/units';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  from: z.string().refine(isIsoDate).optional(),
  to: z.string().refine(isIsoDate).optional()
});

/**
 * Calendário das três unidades em uma resposta. O filtro por unidade é
 * client-side de propósito: o cliente troca de filtro várias vezes seguidas e
 * ir ao servidor a cada clique seria latência sem ganho — o volume é de
 * algumas centenas de datas.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const range = parseQuery(request, schema);
    return json(await unitCalendar(range));
  });
}
