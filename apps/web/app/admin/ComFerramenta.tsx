import { acessoAtual, pode } from '@/server/acesso';
import type { Ferramenta } from '@/lib/ferramentas';

/**
 * Página do painel que só abre com a ferramenta liberada para a conta. A API da
 * ferramenta tem a mesma checagem; aqui é para não mostrar uma tela vazia.
 */
export default async function ComFerramenta({
  chave,
  children
}: {
  chave: Ferramenta;
  children: React.ReactNode;
}) {
  const acesso = await acessoAtual().catch(() => null);
  if (!acesso || !pode(acesso, chave)) {
    return (
      <section className="panel">
        <p className="eyebrow">Acesso</p>
        <h1>Área não liberada.</h1>
        <p className="hint">Esta parte do painel não está liberada para a sua conta.</p>
      </section>
    );
  }
  return <>{children}</>;
}
