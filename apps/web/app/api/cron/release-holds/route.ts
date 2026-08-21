import { config } from '@/server/config';
import { secretMatches } from '@/server/auth';
import { unauthorized } from '@/server/errors';
import { handle, json } from '@/server/http';
import {
  cancelOrphanPayments,
  purgeExpiredSessions,
  purgeOldAuthAttempts,
  releaseExpiredHolds
} from '@/server/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rede de segurança, não o mecanismo principal.
 *
 * A varredura de holds acontece de forma preguiçosa em toda consulta de
 * disponibilidade e em toda criação de reserva — é isso que garante correção
 * sem processo residente. Este cron só faz a limpeza periódica (sessões
 * vencidas, tentativas de login antigas, cobranças órfãs).
 */
export async function GET(request: Request) {
  return handle(async () => {
    const header = request.headers.get('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!presented || !secretMatches(config.cronSecret, presented)) throw unauthorized();

    const holds = await releaseExpiredHolds();
    const orphanPayments = await cancelOrphanPayments();
    const purgedAttempts = await purgeOldAuthAttempts();
    const purgedSessions = await purgeExpiredSessions();

    return json({ holds, orphanPayments, purgedAttempts, purgedSessions });
  });
}
