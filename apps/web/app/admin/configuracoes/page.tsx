import ComFerramenta from '../ComFerramenta';
import ConfiguracoesView from './ConfiguracoesView';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <ComFerramenta chave="configuracoes">
      <ConfiguracoesView />
    </ComFerramenta>
  );
}
