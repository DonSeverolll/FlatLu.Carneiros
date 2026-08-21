import { handle, json } from '@/server/http';
import { findProperty, publicProperty } from '@/server/property';
import { publicRateSummary } from '@/server/rateSummary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) {
  return handle(async () => {
    const { idOrSlug } = await ctx.params;
    const property = await findProperty(idOrSlug);
    const rates = await publicRateSummary(property.id, property.timezone);
    return json({ property: publicProperty(property, rates) });
  });
}
