import ComFerramenta from '../ComFerramenta';
import CatalogoView from './CatalogoView';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <ComFerramenta chave="catalogo">
      <CatalogoView />
    </ComFerramenta>
  );
}
