import ComFerramenta from '../ComFerramenta';
import DashboardView from './DashboardView';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <ComFerramenta chave="dashboard">
      <DashboardView />
    </ComFerramenta>
  );
}
