import { z } from 'zod';
import { isIsoDate } from '@/server/dates';
import { handle, json, parseQuery } from '@/server/http';
import { findProperty } from '@/server/property';
import { quoteForProperty, serializeQuote } from '@/server/quote';
import { rangeIsFree } from '@/server/property';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  checkIn: z.string().refine(isIsoDate),
  checkOut: z.string().refine(isIsoDate)
});

/**
 * Orçamento oficial de uma estadia. A vitrine mostra exatamente o que sai
 * daqui — nenhum cálculo de preço acontece no navegador.
 */
export async function GET(request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) {
  return handle(async () => {
    const { idOrSlug } = await ctx.params;
    const { checkIn, checkOut } = parseQuery(request, schema);
    const property = await findProperty(idOrSlug);
    const quote = await quoteForProperty(property, checkIn, checkOut);
    const available = quote.nights > 0 ? await rangeIsFree(property.id, checkIn, checkOut) : false;
    return json({
      quote: serializeQuote(quote, property.deposit_percentage),
      available,
      currency: property.currency
    });
  });
}
