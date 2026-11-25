import ComFerramenta from '../ComFerramenta';
import CrmView from './CrmView';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <ComFerramenta chave="crm">
      <CrmView />
    </ComFerramenta>
  );
}
