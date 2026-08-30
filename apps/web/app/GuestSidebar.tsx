'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { UserDto } from '@/lib/types';

const ITEMS = [
  { href: '/conta/pagamentos', label: 'Pagamentos', hint: 'Cobranças e situação' },
  { href: '/conta/historico', label: 'Histórico', hint: 'Estadias e datas' },
  { href: '/conta/configuracoes', label: 'Configurações', hint: 'Seus dados e foto' }
];

/**
 * Acesso do hóspede em qualquer página do site.
 *
 * Enquanto ninguém está logado, é um link discreto de entrar. Depois do
 * cadastro vira uma gaveta com foto e atalhos — que é o que substitui o botão
 * solto de "minha conta".
 *
 * O estado de sessão é buscado uma vez por navegação; um 401 aqui é resposta
 * normal (visitante), não erro.
 */
export default function GuestSidebar() {
  const [user, setUser] = useState<UserDto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberta, setAberta] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const carregar = useCallback(async () => {
    try {
      const dados = await api<{ user: UserDto }>('/api/auth/me');
      setUser(dados.user);
    } catch {
      setUser(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, pathname]);

  // O painel tem a própria navegação; duas gavetas na mesma tela confundem.
  if (pathname.startsWith('/admin')) return null;

  if (carregando) return null;

  if (!user) {
    return (
      <Link className="guest-launcher guest-in" href="/login">
        Entrar
      </Link>
    );
  }

  async function sair() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setAberta(false);
      router.push('/');
    }
  }

  const primeiroNome = user.full_name.split(' ')[0] ?? '';
  const iniciais = user.full_name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();

  return (
    <>
      <button
        aria-expanded={aberta}
        aria-label={aberta ? 'Fechar minha conta' : 'Abrir minha conta'}
        className="guest-launcher"
        onClick={() => setAberta((valor) => !valor)}
        type="button"
      >
        <span className="avatar">
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={user.avatar_url} />
          ) : (
            iniciais
          )}
        </span>
        <span className="guest-launcher-name">{primeiroNome}</span>
      </button>

      <aside className={aberta ? 'guest-drawer open' : 'guest-drawer'} aria-label="Minha conta">
        <div className="guest-identity">
          <span className="avatar large">
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={user.avatar_url} />
            ) : (
              iniciais
            )}
          </span>
          <strong>{user.full_name}</strong>
          <small>{user.email}</small>
          {!user.avatar_url && (
            <Link className="link" href="/conta/configuracoes" onClick={() => setAberta(false)}>
              Adicionar foto
            </Link>
          )}
        </div>

        <nav className="guest-nav">
          {ITEMS.map((item) => (
            <Link
              aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
              className={pathname.startsWith(item.href) ? 'guest-link on' : 'guest-link'}
              href={item.href}
              key={item.href}
              onClick={() => setAberta(false)}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </Link>
          ))}
          {user.role === 'ADMIN' && (
            <Link className="guest-link" href="/admin" onClick={() => setAberta(false)}>
              <span>Painel administrativo</span>
              <small>Gestão dos espaços</small>
            </Link>
          )}
        </nav>

        <div className="guest-foot">
          <button className="guest-link exit" onClick={() => void sair()} type="button">
            <span>Sair da conta</span>
          </button>
        </div>
      </aside>

      {aberta && (
        <button className="guest-scrim" onClick={() => setAberta(false)} tabIndex={-1} aria-hidden />
      )}
    </>
  );
}
