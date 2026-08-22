'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import RatePanel from './RatePanel';
import { api, messageFor } from '@/lib/api';
import { PAYMENT_LABEL, STATUS_LABEL, brl, shortDate } from '@/lib/format';

type AdminReservation = {
  id: string;
  check_in: string;
  check_out: string;
  status: string;
  payment_status: string;
  guest_count: number;
  total_amount: string;
  deposit_amount: string;
  unit_slug: string;
  unit_name: string;
  unit_color: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  payment_reference: string | null;
};

export type UnitSummary = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  color: string;
  locationName: string | null;
  nightlyRate: string;
  depositPercentage: string;
  minNights: number;
  maxGuests: number;
  pixConfigured: boolean;
  ratePublished: boolean;
};

function isoToday(offsetDays = 0): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

export default function AdminDashboard({ units }: { units: UnitSummary[] }) {
  const [reservations, setReservations] = useState<AdminReservation[]>([]);
  const [message, setMessage] = useState('Carregando painel...');
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState(units[0]?.slug ?? '');
  /** Filtro da agenda: null = todas as unidades. */
  const [agendaUnit, setAgendaUnit] = useState<string | null>(null);

  const unit = useMemo(
    () => units.find((candidate) => candidate.slug === selectedSlug) ?? units[0]!,
    [units, selectedSlug]
  );

  const load = useCallback(async () => {
    try {
      const filter = agendaUnit ? `&unit=${agendaUnit}` : '';
      const result = await api<{ reservations: AdminReservation[] }>(
        `/api/admin/reservations?from=${isoToday(-30)}&to=${isoToday(365)}${filter}`
      );
      setReservations(result.reservations);
      setMessage('');
    } catch (error) {
      setMessage(messageFor(error));
    }
  }, [agendaUnit]);

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
    const raw = window.prompt('Valor recebido (R$):', Number(suggested).toFixed(2));
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
        body: {
          amount,
          status,
          note: `Conciliado no painel (${reservation.payment_reference ?? 'sem referência'})`
        }
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
      await api(`/api/admin/properties/${unit.id}`, { method: 'PATCH', body });
      setMessage(`Configuração de ${unit.shortName} salva. Recarregue para ver o efeito.`);
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
      await api(`/api/admin/properties/${unit.id}/blocks`, {
        method: 'POST',
        body: {
          startDate: form.get('startDate'),
          endDate: form.get('endDate'),
          source: form.get('source'),
          reason: form.get('reason')
        }
      });
      setMessage(`Período bloqueado em ${unit.shortName}.`);
      (event.target as HTMLFormElement).reset();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  const pending = units.filter((candidate) => !candidate.ratePublished || !candidate.pixConfigured);

  return (
    <main className="account admin-page">
      <Link className="back-link" href="/">
        ← Ver site
      </Link>
      <p className="eyebrow">Painel administrativo</p>
      <h1>Operação dos espaços.</h1>

      {pending.length > 0 && (
        <div className="feedback" role="status">
          {pending.map((candidate) => (
            <p key={candidate.slug}>
              <strong>{candidate.shortName}</strong>:{' '}
              {[
                !candidate.ratePublished && 'tarifa não publicada (vitrine mostra "sob consulta")',
                !candidate.pixConfigured && 'chave Pix não configurada (não dá para cobrar o sinal)'
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ))}
        </div>
      )}

      {/* ---- Agenda: todas as unidades por padrão ---- */}
      <section className="panel">
        <div className="admin-heading">
          <h2>Reservas</h2>
          <button className="button button-small" type="button" onClick={() => void load()}>
            Atualizar
          </button>
        </div>

        <div className="unit-filter">
          <button
            className={agendaUnit === null ? 'unit-tab on' : 'unit-tab'}
            onClick={() => setAgendaUnit(null)}
            type="button"
          >
            Todos os espaços
          </button>
          {units.map((candidate) => (
            <button
              className={agendaUnit === candidate.slug ? 'unit-tab on' : 'unit-tab'}
              key={candidate.slug}
              onClick={() => setAgendaUnit(candidate.slug)}
              style={{ borderBottomColor: candidate.color }}
              type="button"
            >
              <i className="unit-dot" style={{ background: candidate.color }} />
              {candidate.shortName}
            </button>
          ))}
        </div>

        {reservations.length ? (
          <div className="admin-list">
            {reservations.map((reservation) => (
              <article className="booking admin-booking" key={reservation.id}>
                <div>
                  <strong>
                    <i
                      className="unit-dot"
                      style={{ background: reservation.unit_color ?? '#1F3A5F' }}
                    />
                    {reservation.unit_name} · {shortDate(reservation.check_in)} →{' '}
                    {shortDate(reservation.check_out)}
                  </strong>
                  <span>
                    {reservation.customer_name} · {reservation.customer_email}
                    {reservation.customer_phone ? ` · ${reservation.customer_phone}` : ''}
                  </span>
                  <span>
                    {reservation.guest_count}{' '}
                    {reservation.guest_count === 1 ? 'hóspede' : 'hóspedes'}
                    {reservation.payment_reference ? ` · ref. ${reservation.payment_reference}` : ''}
                  </span>
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

      {/* ---- Configuração: uma unidade por vez ---- */}
      <section className="panel unit-switch" style={{ borderTopColor: unit.color }}>
        <h2>Configurar um espaço</h2>
        <div className="unit-filter">
          {units.map((candidate) => (
            <button
              className={candidate.slug === selectedSlug ? 'unit-tab on' : 'unit-tab'}
              key={candidate.slug}
              onClick={() => setSelectedSlug(candidate.slug)}
              style={{ borderBottomColor: candidate.color }}
              type="button"
            >
              <i className="unit-dot" style={{ background: candidate.color }} />
              {candidate.shortName}
            </button>
          ))}
        </div>
        <p className="hint">
          Editando <strong>{unit.name}</strong>
          {unit.locationName ? ` — ${unit.locationName}` : ''}. Tarifas, Pix e bloqueios abaixo
          valem só para este espaço.
        </p>
      </section>

      <div className="account-grid">
        <form className="panel" onSubmit={saveSettings}>
          <h2>Ajustes e Pix</h2>
          <label>
            Diária de fallback (R$)
            <input
              key={`rate-${unit.slug}`}
              name="nightlyRate"
              inputMode="decimal"
              defaultValue={unit.nightlyRate}
            />
          </label>
          <label>
            Sinal (%)
            <input
              key={`dep-${unit.slug}`}
              name="depositPercentage"
              inputMode="decimal"
              defaultValue={unit.depositPercentage}
            />
          </label>
          <label>
            Estadia mínima (noites)
            <input
              key={`min-${unit.slug}`}
              name="minNights"
              type="number"
              min={1}
              max={90}
              defaultValue={unit.minNights}
            />
          </label>
          <label>
            Capacidade (hóspedes)
            <input
              key={`max-${unit.slug}`}
              name="maxGuests"
              type="number"
              min={1}
              max={30}
              defaultValue={unit.maxGuests}
            />
          </label>
          <label>
            Chave Pix
            <input
              key={`pix-${unit.slug}`}
              name="pixKey"
              placeholder={
                unit.pixConfigured ? '••••••• (configurada)' : 'e-mail, CPF/CNPJ, telefone ou aleatória'
              }
            />
          </label>
          <label>
            Nome do favorecido
            <input key={`holder-${unit.slug}`} name="pixHolderName" maxLength={160} />
          </label>
          <button className="button" type="submit" disabled={busy === 'settings'}>
            {busy === 'settings' ? 'Salvando...' : `Salvar ${unit.shortName}`}
          </button>
          <p className="hint">
            A diária de fallback só vale para dias sem tarifa própria; o preço normal vem do
            calendário abaixo. A chave Pix nunca é devolvida pela API depois de salva — só o QR
            gerado no servidor a usa. Cada espaço pode ter uma chave diferente.
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
            {busy === 'block' ? 'Bloqueando...' : `Bloquear em ${unit.shortName}`}
          </button>
          <p className="hint">
            O bloqueio some do calendário público sem revelar o motivo, e vale só para{' '}
            {unit.shortName} — os outros espaços seguem à venda.
          </p>
        </form>
      </div>

      <RatePanel key={unit.slug} propertyId={unit.id} unitName={unit.shortName} />

      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
    </main>
  );
}
