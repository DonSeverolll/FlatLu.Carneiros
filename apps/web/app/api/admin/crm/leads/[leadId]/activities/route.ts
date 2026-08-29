import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { activitySchema, addActivity, leadDetail } from '@/server/crm';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ leadId: z.string().uuid() });

export async function POST(request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { leadId } = params.parse(await ctx.params);
    const input = await parseBody(request, activitySchema);
    await addActivity(leadId, session.id, input);
    return json(await leadDetail(leadId), 201);
  });
}
