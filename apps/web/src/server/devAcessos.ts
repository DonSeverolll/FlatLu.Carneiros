import { z } from 'zod';
import { query } from './db';
import { badRequest, notFound } from './errors';
import { recordAudit } from './audit';
import { CHAVES_FERRAMENTAS, ehFerramenta } from '@/lib/ferramentas';

/**
 * Área Dev: quem libera o quê para cada dono. Só é chamada depois de
 * `requireDev()`, então aqui não há checagem de papel.
 */

export const acessosSchema = z.object({
  userId: z.string().uuid(),
  ferramentas: z.array(z.enum(CHAVES_FERRAMENTAS)).max(CHAVES_FERRAMENTAS.length)
});

export async function listarDonos() {
  const r = await query<{
    id: string;
    full_name: string;
    username: string | null;
    email: string;
    status: string;
    is_dev: boolean;
    ferramentas: string[];
    last_login_at: string | null;
  }>(
    `SELECT id, full_name, username, email, status, is_dev, ferramentas, last_login_at
       FROM users
      WHERE role = 'ADMIN' AND deleted_at IS NULL
      ORDER BY is_dev DESC, full_name`
  );
  return r.rows.map((u) => ({ ...u, ferramentas: u.ferramentas.filter(ehFerramenta) }));
}

export async function definirFerramentas(input: z.infer<typeof acessosSchema>, devId: string) {
  const atual = await query<{ role: string; is_dev: boolean; ferramentas: string[]; full_name: string }>(
    `SELECT role, is_dev, ferramentas, full_name FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [input.userId]
  );
  const alvo = atual.rows[0];
  if (!alvo || alvo.role !== 'ADMIN') throw notFound('USER_NOT_FOUND');
  // A conta Dev tem tudo sempre; não faz sentido (nem é seguro) restringi-la.
  if (alvo.is_dev) throw badRequest('DEV_TEM_TUDO');

  // Ordem fixa: a lista salva fica igual à do menu, e o log compara fácil.
  const novas = CHAVES_FERRAMENTAS.filter((c) => input.ferramentas.includes(c));
  await query(`UPDATE users SET ferramentas = $2, updated_at = now() WHERE id = $1`, [input.userId, novas]);

  const antes = alvo.ferramentas.filter(ehFerramenta);
  await recordAudit({
    actorUserId: devId,
    entityType: 'DEV',
    entityId: input.userId,
    eventType: 'ACESSOS_ALTERADOS',
    metadata: {
      conta: alvo.full_name,
      liberadas: novas.filter((c) => !antes.includes(c)),
      bloqueadas: antes.filter((c) => !novas.includes(c))
    }
  });
  return { ferramentas: novas };
}
