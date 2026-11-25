import { requireFerramenta } from '@/server/acesso';
import { listUsers, userListSchema } from '@/server/adminUsers';
import { handle, json, parseQuery } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    const acesso = await requireFerramenta('usuarios');
    return json({ users: await listUsers(parseQuery(request, userListSchema), acesso.dev) });
  });
}
