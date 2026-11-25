import ComFerramenta from '../ComFerramenta';
import ClientesView from './ClientesView';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <ComFerramenta chave="clientes">
      <ClientesView />
    </ComFerramenta>
  );
}
