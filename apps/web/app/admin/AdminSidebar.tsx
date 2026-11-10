'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type Unit = { slug: string; shortName: string; color: string };

const ITEMS = [
  { href: '/admin', label: 'Menu', hint: 'Tarifas, Pix e bloqueios' },
  { href: '/admin/dashboard', label: 'Dashboard', hint: 'Vendas e ocupação' },
  { href: '/admin/atendimento', label: 'Atendimento', hint: 'WhatsApp e Instagram Direct' },
  { href: '/admin/crm', label: 'CRM', hint: 'Funil de oportunidades' },
  { href: '/admin/marketing', label: 'Marketing', hint: 'Anúncios, origem e retorno' },
  { href: '/admin/catalogo', label: 'Catálogo', hint: 'Fotos do Instagram por espaço' },
  { href: '/admin/clientes', label: 'Clientes', hint: 'Histórico e pagamentos' },
  { href: '/admin/agenda', label: 'Agenda', hint: 'Chegadas, saídas e bloqueios' },
  { href: '/admin/usuarios', label: 'Usuários', hint: 'Acessos e senhas' },
  { href: '/admin/log', label: 'Log', hint: 'Tudo que aconteceu no site' }
];

export default function AdminSidebar({ units }: { units: Unit[] }) {
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
          {ITEMS.map((item) => {
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
                  <span>{item.label}</span>
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
