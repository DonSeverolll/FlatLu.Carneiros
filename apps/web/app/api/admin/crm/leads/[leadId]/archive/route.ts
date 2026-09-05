import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { archiveLead, unarchiveLead } from '@/server/crm';
import { assertSameOrigin, handle, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ leadId: z.string().uuid() });

/** Tira o card do quadro. Só vale em Fechado e Perdido. */
export async function POST(request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { leadId } = params.parse(await ctx.params);
    return json({ archived: await archiveLead(leadId, session.id) });
  });
}

/** Devolve o card ao quadro. */
export async function DELETE(request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { leadId } = params.parse(await ctx.params);
    return json({ restored: await unarchiveLead(leadId, session.id) });
  });
}
