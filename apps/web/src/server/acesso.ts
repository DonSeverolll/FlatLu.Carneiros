import { query } from './db';
import { requireAdmin, type Session } from './auth';
import { forbidden, notFound } from './errors';
import { CHAVES_FERRAMENTAS, ehFerramenta, type Ferramenta } from '@/lib/ferramentas';

/**
 * Quem pode abrir o quê no painel.
 *
 * O token diz só "é administrador"; o que cada administrador pode abrir mora no
 * banco (`users.ferramentas`) e é lido a cada pedido. Assim, bloquear uma
 * ferramenta vale na hora, sem esperar o token expirar.
 *
 * A conta Dev (`users.is_dev`) vê tudo e é a única que mexe nas liberações. Para
 * os outros, ela não existe: a área responde 404 e nenhuma mensagem a menciona.
 */

export type Acesso = Session & { dev: boolean; ferramentas: Ferramenta[] };

export async function acessoAtual(): Promise<Acesso> {
  const session = await requireAdmin();
  const r = await query<{ is_dev: boolean; ferramentas: string[]; status: string; role: string }>(
    `SELECT is_dev, ferramentas, status, role FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [session.id]
  );
  const linha = r.rows[0];
  // O token pode ter até 15 minutos; o banco manda se a conta foi suspensa ou
  // rebaixada nesse meio-tempo.
  if (!linha || linha.status !== 'ACTIVE' || linha.role !== 'ADMIN') throw forbidden();
  return {
    ...session,
    dev: linha.is_dev,
    ferramentas: linha.is_dev ? [...CHAVES_FERRAMENTAS] : linha.ferramentas.filter(ehFerramenta)
  };
}

export function pode(acesso: Pick<Acesso, 'dev' | 'ferramentas'>, ...chaves: Ferramenta[]): boolean {
  return acesso.dev || chaves.some((c) => acesso.ferramentas.includes(c));
}

/** Para rotas `/api/admin/*`: basta uma das ferramentas que usam a rota. */
export async function requireFerramenta(...chaves: Ferramenta[]): Promise<Acesso> {
  const acesso = await acessoAtual();
  if (!pode(acesso, ...chaves)) throw forbidden('FERRAMENTA_BLOQUEADA');
  return acesso;
}

/** Área Dev: para qualquer outra conta, responde como se não existisse. */
export async function requireDev(): Promise<Acesso> {
  let acesso: Acesso;
  try {
    acesso = await acessoAtual();
  } catch {
    throw notFound('NOT_FOUND');
  }
  if (!acesso.dev) throw notFound('NOT_FOUND');
  return acesso;
}
