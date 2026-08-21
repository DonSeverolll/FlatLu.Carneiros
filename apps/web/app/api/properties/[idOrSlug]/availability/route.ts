import { z } from 'zod';
import { isIsoDate } from '@/server/dates';
import { handle, json, parseQuery } from '@/server/http';
import { findProperty, publicProperty, unavailableNights } from '@/server/property';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rangeSchema = z.object({
  from: z.string().refine(isIsoDate).optional(),
  to: z.string().refine(isIsoDate).optional()
});

export async function GET(request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) {
  return handle(async () => {
    const { idOrSlug } = await ctx.params;
    const range = parseQuery(request, rangeSchema);
    const property = await findProperty(idOrSlug);
    const availability = await unavailableNights(property, range);
    // O motivo do bloqueio (manutenção, uso do proprietário) é informação
    // interna: a vitrine só precisa saber que a noite não está à venda.
    return json({ property: publicProperty(property), ...availability });
  });
}
