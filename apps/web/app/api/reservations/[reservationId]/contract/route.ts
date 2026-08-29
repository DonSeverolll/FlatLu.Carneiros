import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';
import { contractStatusFor, getContract, issueContract } from '@/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ reservationId: z.string().uuid() });

/** Estado do fluxo + o contrato, quando já emitido. */
export async function GET(_request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    const session = await requireUser();
    const { reservationId } = params.parse(await ctx.params);
    const status = await contractStatusFor(reservationId, session.id);

    if (!status.contractStatus) return json({ ...status, contract: null });
    return json({ ...status, contract: await getContract(reservationId, session.id) });
  });
}

/** Emite o contrato. Reemitir antes da assinatura atualiza o texto. */
export async function POST(request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireUser();
    const { reservationId } = params.parse(await ctx.params);
    return json({ contract: await issueContract(reservationId, session.id) }, 201);
  });
}
