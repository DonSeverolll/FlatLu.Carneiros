'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, messageFor } from '@/lib/api';
import { PAYMENT_LABEL, STATUS_LABEL, brl, shortDate } from '@/lib/format';
import RatePanel from './RatePanel';

type AdminReservation = {
  id: string;
  check_in: string;
  check_out: string;
  status: string;
  payment_status: string;
  guest_count: number;
  total_amount: string;
  deposit_amount: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  payment_reference: string | null;
};

type PropertySummary = {
  id: string;
  name: string;
  nightlyRate: string;
  depositPercentage: string;
  minNights: number;
  maxGuests: number;
  pixConfigured: boolean;
  pixHolderName: string | null;
  ratePublished: boolean;
};

function isoToday(offsetDays = 0): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

export default function AdminDashboard({ property }: { property: PropertySummary }) {
  const [reservations, setReservations] = useState<AdminReservation[]>([]);
  const [message, setMessage] = useState('Carregando painel...');
  const [busy, setBusy] = useState<string | null>(null);


  const load = useCallback(async () => {
    try {
      const result = await api<{ reservations: AdminReservation[] }>(
        `/api/admin/reservations?from=${isoToday(-30)}&to=${isoToday(365)}`
      );
      setReservations(result.reservations);
      setMessage('');
    } catch (error) {
      setMessage(messageFor(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    const reason = window.prompt('Motivo do cancelamento (mínimo 3 caracteres):');
    if (!reason || reason.trim().length < 3) return;
    const refund = window.confirm('Marcar o pagamento como reembolsado?');
    setBusy(id);
    try {
      await api(`/api/admin/reservations/${id}/cancel`, {
        method: 'POST',
        body: { reason: reason.trim(), refund }
      });
      setMessage('Reserva cancelada.');
      await load();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  /** Conciliação manual do Pix: confere o extrato e confirma aqui. */
  async function confirmPayment(reservation: AdminReservation, status: 'PAID' | 'PARTIAL') {
    const suggested = status === 'PAID' ? reservation.total_amount : reservation.deposit_amount;
    const raw = window.prompt(`Valor recebido (R$):`, Number(suggested).toFixed(2));
    if (!raw) return;
    const amount = Number(raw.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Valor inválido.');
      return;
    }
    setBusy(reservation.id);
    try {
      await api(`/api/admin/reservations/${reservation.id}/confirm-payment`, {
        method: 'POST',
        body: { amount, status, note: `Conciliado no painel (${reservation.payment_reference ?? 'sem referência'})` }
      });
      setMessage(status === 'PAID' ? 'Pagamento total confirmado.' : 'Sinal confirmado.');
      await load();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};

    const rate = Number(String(form.get('nightlyRate') ?? '').replace(',', '.'));
    if (Number.isFinite(rate) && rate >= 0) body.nightlyRate = rate;
    const deposit = Number(String(form.get('depositPercentage') ?? '').replace(',', '.'));
    if (Number.isFinite(deposit)) body.depositPercentage = deposit;
    const minNights = Number(form.get('minNights'));
    if (Number.isInteger(minNights) && minNights >= 1) body.minNights = minNights;
    const maxGuests = Number(form.get('maxGuests'));
    if (Number.isInteger(maxGuests) && maxGuests >= 1) body.maxGuests = maxGuests;

    const pixKey = String(form.get('pixKey') ?? '').trim();
    if (pixKey) body.pixKey = pixKey;
    const pixHolder = String(form.get('pixHolderName') ?? '').trim();
    if (pixHolder) body.pixHolderName = pixHolder;

    setBusy('settings');
    try {
      await api(`/api/admin/properties/${property.id}`, { method: 'PATCH', body });
      setMessage('Configuração salva. Recarregue a vitrine para ver o preço publicado.');
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  async function blockDates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy('block');
    try {
      await api(`/api/admin/properties/${property.id}/blocks`, {
        method: 'POST',
        body: {
          startDate: form.get('startDate'),
          endDate: form.get('endDate'),
          source: form.get('source'),
          reason: form.get('reason')
        }
      });
      setMessage('Período bloqueado.');
      (event.target as HTMLFormElement).reset();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }


  return (
    <main className="account admin-page">
      <Link className="back-link" href="/">
        ← Ver site
      </Link>
      <p className="eyebrow">Painel administrativo</p>
      <h1>Operação do flat.</h1>

      {(!property.ratePublished || !property.pixConfigured) && (
        <p className="feedback" role="status">
          {!property.ratePublished &&
            'Nenhuma tarifa publicada: a vitrine mostra "sob consulta" e reservas são recusadas. '}
          {!property.pixConfigured && 'A chave Pix não está configurada, então não é possível cobrar o sinal.'}
        </p>
      )}

      <section className="panel">
        <div className="admin-heading">
          <h2>Reservas</h2>
          <button className="button button-small" type="button" onClick={() => void load()}>
            Atualizar
          </button>
        </div>
        {reservations.length ? (
          <div className="admin-list">
            {reservations.map((reservation) => (
              <article className="booking admin-booking" key={reservation.id}>
                <div>
                  <strong>
                    {shortDate(reservation.check_in)} → {shortDate(reservation.check_out)}
                  </strong>
                  <span>
                    {reservation.customer_name} · {reservation.customer_email}
                    {reservation.customer_phone ? ` · ${reservation.customer_phone}` : ''}
                  </span>
                  {reservation.payment_reference && (
                    <span>ref. {reservation.payment_reference}</span>
                  )}
                </div>
                <div>
                  <span>
                    {STATUS_LABEL[reservation.status] ?? reservation.status} ·{' '}
                    {PAYMENT_LABEL[reservation.payment_status] ?? reservation.payment_status}
                  </span>
                  <b>{brl(reservation.total_amount)}</b>
                </div>
                <div className="admin-actions">
                  {reservation.payment_status !== 'PAID' &&
                    ['PENDING_PAYMENT', 'CONFIRMED'].includes(reservation.status) && (
                      <>
                        <button
                          className="text-button"
                          type="button"
                          disabled={busy === reservation.id}
                          onClick={() => void confirmPayment(reservation, 'PARTIAL')}
                        >
                          Sinal recebido
                        </button>
                        <button
                          className="text-button"
                          type="button"
                          disabled={busy === reservation.id}
                          onClick={() => void confirmPayment(reservation, 'PAID')}
                        >
                          Pago integral
                        </button>
                      </>
                    )}
                  {['PENDING_PAYMENT', 'CONFIRMED'].includes(reservation.status) && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy === reservation.id}
                      onClick={() => void cancel(reservation.id)}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>Nenhuma reserva no período.</p>
        )}
      </section>

      <div className="account-grid">
        <form className="panel" onSubmit={saveSettings}>
          <h2>Tarifa e Pix</h2>
          <label>
            Diária de fallback (R$)
            <input name="nightlyRate" inputMode="decimal" defaultValue={property.nightlyRate} />
          </label>
          <label>
            Sinal (%)
            <input name="depositPercentage" inputMode="decimal" defaultValue={property.depositPercentage} />
          </label>
          <label>
            Estadia mínima (noites)
            <input name="minNights" type="number" min={1} max={90} defaultValue={property.minNights} />
          </label>
          <label>
            Capacidade (hóspedes)
            <input name="maxGuests" type="number" min={1} max={30} defaultValue={property.maxGuests} />
          </label>
          <label>
            Chave Pix
            <input
              name="pixKey"
              placeholder={property.pixConfigured ? '••••••• (configurada)' : 'e-mail, CPF/CNPJ, telefone ou aleatória'}
            />
          </label>
          <label>
            Nome do favorecido
            <input name="pixHolderName" defaultValue={property.pixHolderName ?? ''} maxLength={160} />
          </label>
          <button className="button" type="submit" disabled={busy === 'settings'}>
            {busy === 'settings' ? 'Salvando...' : 'Salvar'}
          </button>
          <p className="hint">
            A diária de fallback só vale para dias sem tarifa própria; o preço normal vem do
            calendário abaixo. A chave Pix nunca é devolvida pela API depois de salva — só o QR
            gerado no servidor a usa.
          </p>
        </form>

        <form className="panel" onSubmit={blockDates}>
          <h2>Bloquear período</h2>
          <label>
            Início
            <input name="startDate" type="date" required />
          </label>
          <label>
            Fim
            <input name="endDate" type="date" required />
          </label>
          <label>
            Motivo interno
            <select name="source" defaultValue="OWNER_USE">
              <option value="OWNER_USE">Uso do proprietário</option>
              <option value="MAINTENANCE">Manutenção</option>
              <option value="CLEANING">Limpeza</option>
            </select>
          </label>
          <label>
            Observação
            <input name="reason" required minLength={3} maxLength={500} />
          </label>
          <button className="button" type="submit" disabled={busy === 'block'}>
            {busy === 'block' ? 'Bloqueando...' : 'Bloquear'}
          </button>
          <p className="hint">
            O bloqueio some do calendário público sem revelar o motivo, e a constraint do banco
            recusa qualquer sobreposição com reserva existente.
          </p>
        </form>
      </div>

      <RatePanel propertyId={property.id} />

      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
    </main>
  );
}
