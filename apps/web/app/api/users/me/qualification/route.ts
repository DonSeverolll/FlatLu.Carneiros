import { requireUser } from '@/server/auth';
import { assertSameOrigin, handle, json, parseBody } from '@/server/http';
import { contractDataSchema, saveCustomerContractData } from '@/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Qualificação do locatário: RG, CPF, profissão e endereço. Separado do
 * perfil comum porque aqui os campos são obrigatórios — é o que a Cláusula de
 * qualificação do contrato exige.
 */
export async function PUT(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await requireUser();
    const input = await parseBody(request, contractDataSchema);
    return json({ user: await saveCustomerContractData(session.id, input) });
  });
}
