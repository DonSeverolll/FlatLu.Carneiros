import Link from 'next/link';
import AdminSidebar from './AdminSidebar';
import { requireAdmin } from '@/server/auth';
import { listUnits } from '@/server/units';

export const dynamic = 'force-dynamic';

/**
 * Casca do painel. A autorização é verificada aqui e de novo em cada rota
 * `/api/admin/*` — a verificação da página evita mostrar um painel vazio a
 * quem não deveria vê-lo, mas quem protege o dado é a API.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAdmin();
  } catch {
    return (
      <main className="account">
        <p className="eyebrow">Painel administrativo</p>
        <h1>Acesso restrito.</h1>
        <p className="hint">Entre com uma conta de administrador para continuar.</p>
        <div className="row-actions">
          <Link className="button" href="/login">
            Entrar
          </Link>
          <Link className="link" href="/">
            Ver o site
          </Link>
        </div>
      </main>
    );
  }

  // A sidebar mostra os espaços como atalho de contexto; se o banco falhar, o
  // painel continua navegável.
  let units: { slug: string; shortName: string; color: string }[] = [];
  try {
    units = (await listUnits()).map((unit) => ({
      slug: unit.slug,
      shortName: unit.short_name ?? unit.name,
      color: unit.color ?? '#1F3A5F'
    }));
  } catch {
    units = [];
  }

  return (
    <div className="admin-shell">
      <AdminSidebar units={units} />
      <div className="admin-content">{children}</div>
    </div>
  );
}
