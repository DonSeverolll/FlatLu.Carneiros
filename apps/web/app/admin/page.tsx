import Link from 'next/link';
import AdminDashboard from './AdminDashboard';
import { unitCalendar } from '@/server/units';

export const dynamic = 'force-dynamic';

/**
 * Casca de servidor: resolve as unidades que o painel administra. A autorização
 * real acontece nas rotas `/api/admin/*` (`requireAdmin`) — esta página não
 * expõe dado de reserva nenhum antes de o painel autenticar.
 */
export default async function AdminPage() {
  try {
    const calendar = await unitCalendar();
    if (!calendar.units.length) {
      return (
        <main className="account admin-page">
          <Link className="back-link" href="/">
            ← Ver site
          </Link>
          <p className="feedback">Nenhuma unidade cadastrada.</p>
        </main>
      );
    }

    return (
      <AdminDashboard
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
    return (
      <main className="account admin-page">
        <Link className="back-link" href="/">
          ← Ver site
        </Link>
        <p className="feedback">Banco de dados indisponível. Verifique a configuração.</p>
      </main>
    );
  }
}
