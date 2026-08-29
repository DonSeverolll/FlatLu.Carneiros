import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { customerDetail, customerNotesSchema, saveCustomerNotes } from '@/server/adminCustomers';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ customerId: z.string().uuid() });

export async function GET(_request: Request, ctx: { params: Promise<{ customerId: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { customerId } = params.parse(await ctx.params);
    return json(await customerDetail(customerId));
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ customerId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { customerId } = params.parse(await ctx.params);
    const input = await parseBody(request, customerNotesSchema);
    return json({ customer: await saveCustomerNotes(customerId, input) });
  });
}
