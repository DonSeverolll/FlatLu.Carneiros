import { requireDev } from '@/server/acesso';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { acessosSchema, definirFerramentas, listarDonos } from '@/server/devAcessos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Para qualquer conta que não seja a Dev, esta rota responde 404. */
export async function GET() {
  return handle(async () => {
    await requireDev();
    return json({ donos: await listarDonos() });
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const dev = await requireDev();
    const input = await parseBody(request, acessosSchema);
    return json(await definirFerramentas(input, dev.id));
  });
}
