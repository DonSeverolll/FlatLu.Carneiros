'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/api';
import { PAYMENT_LABEL, STATUS_LABEL, brl, shortDate } from '@/lib/format';
import type { ReservationDto, UserDto } from '@/lib/types';

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserDto | null>(null);
  const [reservations, setReservations] = useState<ReservationDto[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [profile, bookings] = await Promise.all([
        api<{ user: UserDto }>('/api/auth/me'),
        api<{ reservations: ReservationDto[] }>('/api/reservations/mine')
      ]);
      setUser(profile.user);
      setReservations(bookings.reservations);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage('');
    try {
      const result = await api<{ user: UserDto }>('/api/users/me', {
        method: 'PATCH',
        body: {
          fullName: form.get('fullName'),
          phone: form.get('phone') || null,
          documentNumber: form.get('documentNumber') || null
        }
      });
      setUser(result.user);
      setMessage('Perfil atualizado.');
    } catch (error) {
      setMessage(messageFor(error));
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/');
    }
  }

  if (loading) {
    return (
      <main className="account">
        <p>Carregando sua conta...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="account">
        <p>Entre para acessar sua conta.</p>
        <div className="row-actions">
          <Link className="button" href="/login">
            Entrar
          </Link>
          <Link className="link" href="/cadastro">
            Criar conta
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="account">
      <Link className="back-link" href="/">
        ← Voltar
      </Link>
      <p className="eyebrow">Área do hóspede</p>
      <h1>Olá, {user.full_name.split(' ')[0]}.</h1>

      <div className="account-grid">
        <form className="panel" onSubmit={updateProfile}>
          <h2>Seu perfil</h2>
          <label>
            Nome completo
            <input name="fullName" defaultValue={user.full_name} required minLength={3} />
          </label>
          <label>
            E-mail
            <input value={user.email} disabled />
          </label>
          <label>
            Telefone
            <input name="phone" defaultValue={user.phone ?? ''} maxLength={32} />
          </label>
          <label>
            Documento
            <input name="documentNumber" defaultValue={user.document_number ?? ''} maxLength={32} />
          </label>
          <button className="button" type="submit">
            Salvar perfil
          </button>
          <button className="link" type="button" onClick={() => void logout()}>
            Sair da conta
          </button>
        </form>

        <section className="panel">
          <h2>Suas reservas</h2>
          {reservations.length ? (
            reservations.map((reservation) => {
              const payable =
                reservation.status === 'PENDING_PAYMENT' && reservation.payment_status !== 'PAID';
              return (
                <article className="booking" key={reservation.id}>
                  <strong>
                    <i
                      className="unit-dot"
                      style={{ background: reservation.unit_color ?? '#1F3A5F' }}
                    />
                    {reservation.unit_name ?? 'Reserva'} · {shortDate(reservation.check_in)} →{' '}
                    {shortDate(reservation.check_out)}
                  </strong>
                  <span>
                    {STATUS_LABEL[reservation.status] ?? reservation.status} ·{' '}
                    {PAYMENT_LABEL[reservation.payment_status] ?? reservation.payment_status}
                  </span>
                  <b>{brl(reservation.total_amount)}</b>
                  {payable && (
                    <Link className="button small" href={`/reserva/${reservation.id}`}>
                      Pagar sinal
                    </Link>
                  )}
                </article>
              );
            })
          ) : (
            <p>
              Nenhuma reserva ainda. <Link href="/#reserva">Consultar datas</Link>
            </p>
          )}
        </section>
      </div>
      {message && <p className="feedback">{message}</p>}
    </main>
  );
}
