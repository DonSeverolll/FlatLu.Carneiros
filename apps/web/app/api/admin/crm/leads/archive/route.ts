import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { archiveStage } from '@/server/crm';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Esvazia uma coluna encerrada inteira — a faxina é sempre feita em bloco. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireAdmin();
    const input = await parseBody(request, z.object({ stage: z.enum(['WON', 'LOST']) }));
    return json(await archiveStage(input.stage, session.id));
  });
}
