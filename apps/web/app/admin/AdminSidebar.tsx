'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AREA_DEV, FERRAMENTAS, type Ferramenta } from '@/lib/ferramentas';

type Unit = { slug: string; shortName: string; color: string };

// Configurações fica no rodapé da barra; as outras ferramentas, na lista.
const ITEMS = FERRAMENTAS.filter((f) => f.chave !== 'configuracoes');

export default function AdminSidebar({
  units,
  ferramentas,
  dev
}: {
  units: Unit[];
  /** Só o que está liberado para a conta aparece. */
  ferramentas: Ferramenta[];
  dev: boolean;
}) {
  const liberada = (chave: Ferramenta) => ferramentas.includes(chave);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/');
    }
  }

  return (
    <>
      {/* Em tela pequena a sidebar vira gaveta; o botão fica sempre acessível. */}
      <button
        aria-expanded={open}
        aria-label={open ? 'Fechar menu' : 'Abrir menu'}
        className="sidebar-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? '✕' : '☰'}
      </button>

      <nav className={open ? 'sidebar open' : 'sidebar'} aria-label="Painel administrativo">
        <div className="sidebar-brand">
          <strong>APT CARNEIROS</strong>
          <small>Painel administrativo</small>
        </div>

        <ul className="sidebar-nav">
          {ITEMS.filter((item) => liberada(item.chave)).map((item) => {
            // `/admin` casaria com tudo; só ele exige igualdade exata.
            const active =
              item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={active ? 'sidebar-link on' : 'sidebar-link'}
                  href={item.href}
                  onClick={() => setOpen(false)}
                >
                  <span>{item.rotulo}</span>
                  <small>{item.hint}</small>
                </Link>
              </li>
            );
          })}
        </ul>

        {units.length > 0 && (
          <div className="sidebar-units">
            <p className="sidebar-section">Espaços</p>
            {units.map((unit) => (
              <span key={unit.slug}>
                <i style={{ background: unit.color }} />
                {unit.shortName}
              </span>
            ))}
          </div>
        )}

        <div className="sidebar-foot">
          {dev && (
            <Link
              aria-current={pathname.startsWith(AREA_DEV) ? 'page' : undefined}
              className={pathname.startsWith(AREA_DEV) ? 'sidebar-link on' : 'sidebar-link'}
              href={AREA_DEV}
              onClick={() => setOpen(false)}
            >
              <span>Dev</span>
              <small>Liberar ferramentas para os donos</small>
            </Link>
          )}
          {liberada('configuracoes') && (
          <Link
            aria-current={pathname.startsWith('/admin/configuracoes') ? 'page' : undefined}
            className={
              pathname.startsWith('/admin/configuracoes') ? 'sidebar-link sidebar-config on' : 'sidebar-link sidebar-config'
            }
            href="/admin/configuracoes"
            onClick={() => setOpen(false)}
          >
            <span>
              <svg aria-hidden="true" className="gear" viewBox="0 0 24 24" width="16" height="16">
                <path
                  d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.5a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z"
                  fill="none"
                  stroke="currentColor"
                  strokeLinejoin="round"
                  strokeWidth="1.6"
                />
              </svg>
              Configurações
            </span>
            <small>Ferramentas, integrações e IA</small>
          </Link>
          )}
          <Link className="sidebar-link" href="/">
            <span>Ver o site</span>
          </Link>
          <button className="sidebar-link exit" onClick={() => void logout()} type="button">
            <span>Sair da conta</span>
          </button>
        </div>
      </nav>

      {open && <button className="sidebar-scrim" onClick={() => setOpen(false)} tabIndex={-1} aria-hidden />}
    </>
  );
}
