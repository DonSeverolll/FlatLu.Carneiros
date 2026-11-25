import ComFerramenta from '../ComFerramenta';
import LogView from './LogView';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <ComFerramenta chave="log">
      <LogView />
    </ComFerramenta>
  );
}
