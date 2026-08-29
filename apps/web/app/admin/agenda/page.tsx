import AgendaView from './AgendaView';
import { listUnits } from '@/server/units';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const units = (await listUnits()).map((unit) => ({
    slug: unit.slug,
    shortName: unit.short_name ?? unit.name,
    color: unit.color ?? '#1F3A5F'
  }));
  return <AgendaView units={units} />;
}
