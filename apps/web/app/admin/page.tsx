import Link from 'next/link';
import AdminDashboard from './AdminDashboard';
import { config } from '@/server/config';
import { findProperty } from '@/server/property';

export const dynamic = 'force-dynamic';

/**
 * Casca de servidor só para resolver qual propriedade o painel administra —
 * o slug é configuração de ambiente e não deve ir para o bundle do navegador.
 * A autorização real acontece nas rotas `/api/admin/*` (`requireAdmin`); esta
 * página não expõe dado nenhum antes de o painel autenticar.
 */
export default async function AdminPage() {
  try {
    const property = await findProperty(config.propertySlug);
    return (
      <AdminDashboard
        property={{
          id: property.id,
          name: property.name,
          nightlyRate: property.nightly_rate,
          depositPercentage: property.deposit_percentage,
          minNights: property.min_nights,
          maxGuests: property.max_guests,
          pixConfigured: Boolean(property.pix_key),
          pixHolderName: property.pix_holder_name
        }}
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
