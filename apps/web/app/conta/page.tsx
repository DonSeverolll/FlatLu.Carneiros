'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { CHARGE_STATUS, STATUS_LABEL, brl, longDate } from '@/lib/format';
import type { ReservationDto, UserDto } from '@/lib/types';

type Cobranca = {
  id: string;
  amount: string;
  status: string;
  rawStatus: string;
  reservation_id: string;
  unit_name: string;
};

const hoje = () => new Date().toISOString().slice(0, 10);

/** Panorama da conta: o que vem a seguir e o que está em aberto. */
export default function ContaPage() {
  const [user, setUser] = useState<UserDto | null>(null);
  const [reservas, setReservas] = useState<ReservationDto[]>([]);
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const [perfil, estadias, pagamentos] = await Promise.all([
        api<{ user: UserDto }>('/api/auth/me'),
        api<{ reservations: ReservationDto[] }>('/api/reservations/mine'),
        api<{ payments: Cobranca[] }>('/api/me/payments')
      ]);
      setUser(perfil.user);
      setReservas(estadias.reservations);
      setCobrancas(pagamentos.payments);
    } catch {
      setUser(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) return <p>Carregando sua conta...</p>;

  if (!user) {
    return (
      <>
        <p className="eyebrow">Área do hóspede</p>
        <h1>Entre para continuar.</h1>
        <div className="row-actions">
          <Link className="button" href="/login">
            Entrar
          </Link>
          <Link className="link" href="/cadastro">
            Criar conta
          </Link>
        </div>
      </>
    );
  }

  const proxima = reservas
    .filter((r) => r.check_in >= hoje() && r.status !== 'CANCELLED')
    .sort((a, b) => a.check_in.localeCompare(b.check_in))[0];
  const aberto = cobrancas.filter((c) => ['PENDING', 'PROCESSING', 'OVERDUE'].includes(c.status));
  const pendencia = !user.document_number || !user.rg || !user.address_line;

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Minha conta</p>
          <h1>Olá, {user.full_name.split(' ')[0]}.</h1>
        </div>
      </header>

      {pendencia && (
        <p className="feedback">
          Faltam seus dados para o contrato.{' '}
          <Link href="/conta/configuracoes">Completar agora</Link>
        </p>
      )}

      <div className="account-grid">
        <section className="panel">
          <h2>Próxima estadia</h2>
          {proxima ? (
            <>
              <dl className="facts stacked">
                <div>
                  <dt>Espaço</dt>
                  <dd>{proxima.unit_name ?? '—'}</dd>
                </div>
                <div>
                  <dt>Entrada</dt>
                  <dd>{longDate(proxima.check_in)} a partir das 09:00</dd>
                </div>
                <div>
                  <dt>Saída</dt>
                  <dd>{longDate(proxima.check_out)} até as 16:00</dd>
                </div>
                <div>
                  <dt>Situação</dt>
                  <dd>{STATUS_LABEL[proxima.status] ?? proxima.status}</dd>
                </div>
              </dl>
              {proxima.status === 'PENDING_PAYMENT' && (
                <Link className="button" href={`/reserva/${proxima.id}`}>
                  Continuar reserva
                </Link>
              )}
            </>
          ) : (
            <p className="hint">
              Nenhuma estadia marcada. <Link href="/#reserva">Consultar datas</Link>
            </p>
          )}
        </section>

        <section className="panel">
          <h2>Em aberto</h2>
          {aberto.length ? (
            <div className="stay-list">
              {aberto.map((cobranca) => (
                <article className="stay" key={cobranca.id}>
                  <div>
                    <strong>{cobranca.unit_name}</strong>
                    <small>{CHARGE_STATUS[cobranca.status]?.label ?? cobranca.status}</small>
                  </div>
                  <div className="stay-side">
                    <b>{brl(cobranca.amount)}</b>
                    <Link className="button small" href={`/reserva/${cobranca.reservation_id}`}>
                      Pagar
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="hint">Nada pendente.</p>
          )}
          <Link className="link" href="/conta/pagamentos">
            Ver todos os pagamentos
          </Link>
        </section>
      </div>
    </>
  );
}
