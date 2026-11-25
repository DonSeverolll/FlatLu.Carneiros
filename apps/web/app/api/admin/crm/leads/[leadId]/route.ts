import { requireFerramenta } from '@/server/acesso';
import { z } from 'zod';
import { leadDetail, leadUpdateSchema, updateLead } from '@/server/crm';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ leadId: z.string().uuid() });

export async function GET(_request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  return handle(async () => {
    await requireFerramenta('crm');
    const { leadId } = params.parse(await ctx.params);
    return json(await leadDetail(leadId));
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireFerramenta('crm');
    const { leadId } = params.parse(await ctx.params);
    const input = await parseBody(request, leadUpdateSchema);
    return json(await updateLead(leadId, session.id, input));
  });
}
