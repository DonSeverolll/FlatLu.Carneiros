import ComFerramenta from '../ComFerramenta';
import UsuariosView from './UsuariosView';
import { acessoAtual } from '@/server/acesso';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const acesso = await acessoAtual().catch(() => null);
  return (
    <ComFerramenta chave="usuarios">
      <UsuariosView souDev={acesso?.dev ?? false} />
    </ComFerramenta>
  );
}
