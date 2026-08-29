import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { requestContext } from '@/server/request';
import { signContract, signContractSchema } from '@/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ reservationId: z.string().uuid() });

/**
 * Aceite eletrônico. O IP e o user-agent vão para o registro porque são o que
 * dá lastro à assinatura simples da Lei 14.063/2020.
 */
export async function POST(request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireUser();
    const { reservationId } = params.parse(await ctx.params);
    const input = await parseBody(request, signContractSchema);
    const result = await signContract(reservationId, session.id, input, requestContext(request));
    return json(result);
  });
}
