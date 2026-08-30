'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, messageFor } from '@/lib/api';
import { PAYMENT_LABEL, STATUS_LABEL, brl, longDate } from '@/lib/format';
import type { ReservationDto } from '@/lib/types';

const hoje = () => new Date().toISOString().slice(0, 10);

/** Histórico de estadias, com entrada, saída e situação de cada uma. */
export default function HistoricoView() {
  const [reservas, setReservas] = useState<ReservationDto[]>([]);
  const [mensagem, setMensagem] = useState('Carregando histórico...');

  const carregar = useCallback(async () => {
    try {
      const dados = await api<{ reservations: ReservationDto[] }>('/api/reservations/mine');
      setReservas(dados.reservations);
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const futuras = reservas.filter((r) => r.check_out >= hoje() && r.status !== 'CANCELLED');
  const passadas = reservas.filter((r) => r.check_out < hoje() || r.status === 'CANCELLED');
  const noites = passadas
    .filter((r) => r.status === 'COMPLETED' || r.status === 'CONFIRMED')
    .reduce((soma, r) => {
      const dias = (Date.parse(r.check_out) - Date.parse(r.check_in)) / 86_400_000;
      return soma + Math.round(dias);
    }, 0);

  function Cartao({ reserva }: { reserva: ReservationDto }) {
    return (
      <article
        className="stay"
        style={{ borderLeftColor: reserva.unit_color ?? '#1F3A5F' }}
      >
        <div>
          <strong>{reserva.unit_name ?? 'Reserva'}</strong>
          {reserva.unit_location && <small>{reserva.unit_location}</small>}
          <small>
            Entrada {longDate(reserva.check_in)}
            {reserva.check_in_time ? ` a partir das ${reserva.check_in_time.slice(0, 5)}` : ''}
          </small>
          <small>
            Saída {longDate(reserva.check_out)}
            {reserva.check_out_time ? ` até as ${reserva.check_out_time.slice(0, 5)}` : ''}
          </small>
          <small>
            {reserva.guest_count} {reserva.guest_count === 1 ? 'hóspede' : 'hóspedes'}
          </small>
        </div>
        <div className="stay-side">
          <b>{brl(reserva.total_amount)}</b>
          <em className="tag">{STATUS_LABEL[reserva.status] ?? reserva.status}</em>
          <small>{PAYMENT_LABEL[reserva.payment_status] ?? reserva.payment_status}</small>
          {reserva.status === 'PENDING_PAYMENT' && (
            <Link className="button small" href={`/reserva/${reserva.id}`}>
              Continuar
            </Link>
          )}
        </div>
      </article>
    );
  }

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Minha conta</p>
          <h1>Histórico de estadias.</h1>
        </div>
      </header>

      {mensagem && <p className="feedback">{mensagem}</p>}

      {reservas.length > 0 && (
        <section className="stat-grid">
          <div className="stat-tile">
            <span className="stat-label">Estadias</span>
            <strong className="stat-value">{passadas.length}</strong>
            <small className="stat-hint">já realizadas</small>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Noites</span>
            <strong className="stat-value">{noites}</strong>
          </div>
          <div className="stat-tile good">
            <span className="stat-label">Próximas</span>
            <strong className="stat-value">{futuras.length}</strong>
          </div>
        </section>
      )}

      {futuras.length > 0 && (
        <section className="panel">
          <h2>Próximas</h2>
          <div className="stay-list">
            {futuras.map((reserva) => (
              <Cartao key={reserva.id} reserva={reserva} />
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Anteriores</h2>
        {passadas.length ? (
          <div className="stay-list">
            {passadas.map((reserva) => (
              <Cartao key={reserva.id} reserva={reserva} />
            ))}
          </div>
        ) : (
          <p className="hint">
            {reservas.length
              ? 'Nenhuma estadia concluída ainda.'
              : 'Você ainda não reservou. '}
            {!reservas.length && <Link href="/#reserva">Consultar datas</Link>}
          </p>
        )}
      </section>
    </>
  );
}
