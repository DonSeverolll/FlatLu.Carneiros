import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * A navegação da conta é a própria gaveta do hóspede (GuestSidebar), montada
 * no layout raiz. Aqui só o enquadramento da página.
 */
export default function ContaLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="account guest-area">
      <Link className="back-link" href="/">
        ← Voltar ao site
      </Link>
      {children}
    </main>
  );
}
