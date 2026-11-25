import ComFerramenta from '../ComFerramenta';
import AtendimentoView from './AtendimentoView';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <ComFerramenta chave="atendimento">
      <AtendimentoView />
    </ComFerramenta>
  );
}
