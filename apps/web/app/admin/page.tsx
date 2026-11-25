import Link from 'next/link';
import AdminDashboard from './AdminDashboard';
import { acessoAtual, pode } from '@/server/acesso';
import { FERRAMENTAS } from '@/lib/ferramentas';
import { unitCalendar } from '@/server/units';

export const dynamic = 'force-dynamic';

/**
 * Casca de servidor: resolve as unidades que o painel administra. A autorização
 * real acontece nas rotas `/api/admin/*` (`requireAdmin`) — esta página não
 * expõe dado de reserva nenhum antes de o painel autenticar.
 */
export default async function AdminPage() {
  // Sem o Menu liberado, a entrada do painel lista o que a conta pode abrir.
  const acesso = await acessoAtual().catch(() => null);
  if (!acesso || !pode(acesso, 'menu')) {
    const liberadas = FERRAMENTAS.filter((f) => f.chave !== 'menu' && acesso && pode(acesso, f.chave));
    return (
      <section className="panel">
        <p className="eyebrow">Painel</p>
        <h1>Bem-vindo.</h1>
        {liberadas.length ? (
          <ul className="painel-atalhos">
            {liberadas.map((f) => (
              <li key={f.chave}>
                <Link href={f.href}>{f.rotulo}</Link>
                <small>{f.hint}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Nenhuma área do painel está liberada para a sua conta ainda.</p>
        )}
      </section>
    );
  }

  try {
    const calendar = await unitCalendar();
    if (!calendar.units.length) {
      return <p className="feedback">Nenhuma unidade cadastrada.</p>;
    }

    return (
      <AdminDashboard
        verDashboard={pode(acesso, 'dashboard')}
        units={calendar.units.map((unit) => ({
          id: unit.id,
          slug: unit.slug,
          name: unit.name,
          shortName: unit.shortName,
          color: unit.color,
          locationName: unit.locationName,
          nightlyRate: unit.nightlyRate,
          depositPercentage: unit.depositPercentage,
          minNights: unit.minNights,
          maxGuests: unit.maxGuests,
          pixConfigured: unit.pixConfigured,
          ratePublished: unit.ratePublished
        }))}
      />
    );
  } catch {
    return <p className="feedback">Banco de dados indisponível. Verifique a configuração.</p>;
  }
}
