import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { updateProperty, updatePropertySchema } from '@/server/admin';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, ctx: { params: Promise<{ propertyId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const { propertyId } = z.object({ propertyId: z.string().uuid() }).parse(await ctx.params);
    const input = await parseBody(request, updatePropertySchema);
    return json({ property: await updateProperty(propertyId, session.id, input) });
  });
}
