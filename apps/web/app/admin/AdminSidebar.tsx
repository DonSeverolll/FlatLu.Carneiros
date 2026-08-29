'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type Unit = { slug: string; shortName: string; color: string };

const ITEMS = [
  { href: '/admin', label: 'Menu', hint: 'Tarifas, Pix e bloqueios' },
  { href: '/admin/dashboard', label: 'Dashboard', hint: 'Vendas e ocupação' },
  { href: '/admin/crm', label: 'CRM', hint: 'Funil de oportunidades' },
  { href: '/admin/clientes', label: 'Clientes', hint: 'Histórico e pagamentos' },
  { href: '/admin/agenda', label: 'Agenda', hint: 'Chegadas e saídas' },
  { href: '/admin/usuarios', label: 'Usuários', hint: 'Acessos e senhas' }
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
