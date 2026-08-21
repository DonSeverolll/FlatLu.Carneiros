'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Reservation = { id: string; check_in: string; check_out: string; status: string; payment_status: string; total_amount: string; customer_name: string; customer_email: string };

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function AdminPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [message, setMessage] = useState('Carregando painel...');

  async function loadReservations() {
    const from = new Date();
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + 365);
    const response = await fetch(`${API_URL}/admin/reservations?from=${formatDate(from)}&to=${formatDate(to)}`, { credentials: 'include' });
    if (response.status === 401 || response.status === 403) {
      setMessage('Acesso restrito ao painel administrativo.');
      return;
    }
    if (!response.ok) {
      setMessage('Não foi possível carregar as reservas.');
      return;
    }
    const result = await response.json();
    setReservations(result.reservations);
    setMessage('');
  }

  useEffect(() => { void loadReservations(); }, []);

  async function cancelReservation(id: string) {
    const response = await fetch(`${API_URL}/admin/reservations/${id}/cancel`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelada pelo administrador.' })
    });
    setMessage(response.ok ? 'Reserva cancelada.' : 'Não foi possível cancelar a reserva.');
    if (response.ok) await loadReservations();
  }

  return <main className="account admin-page">
    <a className="back-link" href="/">← Ver site</a>
    <p className="eyebrow">Painel administrativo</p>
    <h1>Operação do flat.</h1>
    <section className="panel">
      <div className="admin-heading"><h2>Reservas</h2><button className="button button-small" type="button" onClick={() => void loadReservations()}>Atualizar</button></div>
      {reservations.length ? <div className="admin-list">{reservations.map((reservation) => <article className="booking admin-booking" key={reservation.id}>
        <div><strong>{reservation.check_in} → {reservation.check_out}</strong><span>{reservation.customer_name} · {reservation.customer_email}</span></div>
        <div><span>{reservation.status} · {reservation.payment_status}</span><b>R$ {Number(reservation.total_amount).toFixed(2)}</b></div>
        {['PENDING_PAYMENT', 'CONFIRMED'].includes(reservation.status) && <button className="text-button" type="button" onClick={() => void cancelReservation(reservation.id)}>Cancelar</button>}
      </article>)}</div> : <p>Nenhuma reserva no período.</p>}
    </section>
    {message && <p className="feedback" role="status">{message}</p>}
  </main>;
}