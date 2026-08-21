'use client';

import { FormEvent, useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type User = { email: string; full_name: string; phone: string | null; document_number: string | null };
type Reservation = { id: string; check_in: string; check_out: string; status: string; payment_status: string; total_amount: string };

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [message, setMessage] = useState('Carregando sua conta...');

  useEffect(() => {
    async function loadAccount() {
      const [profileResponse, reservationsResponse] = await Promise.all([
        fetch(`${API_URL}/auth/me`, { credentials: 'include' }),
        fetch(`${API_URL}/reservations/mine`, { credentials: 'include' })
      ]);
      if (!profileResponse.ok || !reservationsResponse.ok) {
        setMessage('Faça login para acessar sua conta.');
        return;
      }
      const profile = await profileResponse.json();
      const bookings = await reservationsResponse.json();
      setUser(profile.user);
      setReservations(bookings.reservations);
      setMessage('');
    }
    void loadAccount();
  }, []);

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${API_URL}/users/me`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: form.get('fullName'), phone: form.get('phone'), documentNumber: form.get('documentNumber') })
    });
    if (response.ok) {
      const result = await response.json();
      setUser(result.user);
      setMessage('Perfil atualizado.');
    } else setMessage('Não foi possível atualizar o perfil.');
  }

  if (!user) return <main className="account"><p>{message}</p><a className="button" href="/">Voltar para a vitrine</a></main>;

  return <main className="account">
    <a className="back-link" href="/">← Voltar</a>
    <p className="eyebrow">Área do hóspede</p>
    <h1>Olá, {user.full_name.split(' ')[0]}.</h1>
    <div className="account-grid">
      <form className="panel" onSubmit={updateProfile}>
        <h2>Seu perfil</h2>
        <label>Nome completo<input name="fullName" defaultValue={user.full_name} required minLength={3} /></label>
        <label>E-mail<input value={user.email} disabled /></label>
        <label>Telefone<input name="phone" defaultValue={user.phone ?? ''} /></label>
        <label>Documento<input name="documentNumber" defaultValue={user.document_number ?? ''} /></label>
        <button className="button" type="submit">Salvar perfil</button>
      </form>
      <section className="panel"><h2>Suas reservas</h2>{reservations.length ? reservations.map((reservation) => <article className="booking" key={reservation.id}><strong>{reservation.check_in} → {reservation.check_out}</strong><span>{reservation.status} · pagamento {reservation.payment_status}</span><b>R$ {Number(reservation.total_amount).toFixed(2)}</b></article>) : <p>Nenhuma reserva encontrada.</p>}</section>
    </div>
    {message && <p className="feedback">{message}</p>}
  </main>;
}
