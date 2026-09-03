import { recordAudit } from '@/server/audit';
import { requireUser, revokeCurrentSession } from '@/server/auth';
import { assertSameOrigin, handle, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);

    // Quem está saindo, para o log. Sair com sessão já expirada é legítimo e
    // continua respondendo ok — só não há a quem atribuir o evento.
    let saindo: string | null = null;
    try {
      saindo = (await requireUser()).id;
    } catch {
      saindo = null;
    }

    await revokeCurrentSession();

    if (saindo) {
      await recordAudit({
        actorUserId: saindo,
        entityType: 'SESSION',
        entityId: saindo,
        eventType: 'LOGOUT'
      });
    }
    return json({ ok: true });
  });
}
