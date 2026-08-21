import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { listWeekdayRates, replaceWeekdayRates, weekdayRatesSchema } from '@/server/rateStore';
import { query } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ propertyId: z.string().uuid() });

export async function GET(_request: Request, ctx: { params: Promise<{ propertyId: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { propertyId } = params.parse(await ctx.params);
    return json({ rates: await listWeekdayRates(propertyId) });
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ propertyId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { propertyId } = params.parse(await ctx.params);
    const input = await parseBody(request, weekdayRatesSchema);
    const rates = await replaceWeekdayRates(propertyId, input);
    await query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'PROPERTY', $2, 'WEEKDAY_RATES_UPDATED', $3)`,
      [session.id, propertyId, JSON.stringify({ rates: input.rates })]
    );
    return json({ rates });
  });
}
