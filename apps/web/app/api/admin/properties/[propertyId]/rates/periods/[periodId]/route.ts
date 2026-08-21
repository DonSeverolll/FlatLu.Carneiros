import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';
import { deleteRatePeriod } from '@/server/rateStore';
import { query } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ propertyId: z.string().uuid(), periodId: z.string().uuid() });

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ propertyId: string; periodId: string }> }
) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { propertyId, periodId } = params.parse(await ctx.params);
    const period = await deleteRatePeriod(propertyId, periodId);
    await query(
      `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, event_type, metadata)
       VALUES ($1, 'PROPERTY', $2, 'RATE_PERIOD_DEACTIVATED', $3)`,
      [session.id, propertyId, JSON.stringify(period)]
    );
    return json({ period });
  });
}
