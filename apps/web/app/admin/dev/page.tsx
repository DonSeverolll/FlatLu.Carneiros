import { notFound } from 'next/navigation';
import DevView from './DevView';
import { acessoAtual } from '@/server/acesso';

export const dynamic = 'force-dynamic';

/** Só existe para a conta Dev; para as outras, é uma página que não existe. */
export default async function Page() {
  const acesso = await acessoAtual().catch(() => null);
  if (!acesso?.dev) notFound();
  return <DevView meuId={acesso.id} />;
}
