import { requireUser } from '@/server/auth';
import { handle, json } from '@/server/http';
import { paymentsForCustomer } from '@/server/payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Extrato do hóspede: toda cobrança dele, em qualquer espaço. */
export async function GET() {
  return handle(async () => {
    const session = await requireUser();
    return json({ payments: await paymentsForCustomer(session.id) });
  });
}
