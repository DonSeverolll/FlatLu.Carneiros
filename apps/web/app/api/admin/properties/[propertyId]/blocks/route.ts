import { requireFerramenta } from '@/server/acesso';
import { z } from 'zod';
import { blockDates, maintenanceSchema } from '@/server/admin';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ propertyId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireFerramenta('menu', 'agenda');
    const { propertyId } = z.object({ propertyId: z.string().uuid() }).parse(await ctx.params);
    const input = await parseBody(request, maintenanceSchema);
    return json({ block: await blockDates(propertyId, session.id, input) }, 201);
  });
}
