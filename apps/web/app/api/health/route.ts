import { query } from '@/server/db';
import { handle, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const result = await query<{ now: string }>('SELECT now()::text AS now');
    return json({ status: 'ok', database: 'up', time: result.rows[0]?.now });
  });
}
