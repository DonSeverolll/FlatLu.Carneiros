'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import RatePanel from './RatePanel';
import { api, messageFor } from '@/lib/api';

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

/**
 * Menu: configuração dos espaços. A lista de reservas vive na Agenda — tê-la
 * nos dois lugares só criaria duas verdades sobre o mesmo dado.
 */
export default function AdminDashboard({ units }: { units: UnitSummary[] }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState(units[0]?.slug ?? '');

  const unit = useMemo(
    () => units.find((candidate) => candidate.slug === selectedSlug) ?? units[0]!,
    [units, selectedSlug]
  );

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
    const gapDays = Number(form.get('cleaningGapDays'));
    if (Number.isInteger(gapDays) && gapDays >= 0) body.cleaningGapDays = gapDays;

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
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Menu</p>
          <h1>Configuração dos espaços.</h1>
        </div>
        <Link className="link" href="/admin/dashboard">
          Ver indicadores
        </Link>
      </header>

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

      <section className="panel unit-switch" style={{ borderTopColor: unit.color }}>
        <h2>Escolha o espaço</h2>
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
            <input key={`rate-${unit.slug}`} name="nightlyRate" inputMode="decimal" defaultValue={unit.nightlyRate} />
          </label>
          <label>
            Sinal (%)
            <input key={`dep-${unit.slug}`} name="depositPercentage" inputMode="decimal" defaultValue={unit.depositPercentage} />
          </label>
          <label>
            Estadia mínima (noites)
            <input key={`min-${unit.slug}`} name="minNights" type="number" min={1} max={90} defaultValue={unit.minNights} />
          </label>
          <label>
            Capacidade (hóspedes)
            <input key={`max-${unit.slug}`} name="maxGuests" type="number" min={1} max={30} defaultValue={unit.maxGuests} />
          </label>
          <label>
            Dias de folga entre hóspedes
            <input key={`gap-${unit.slug}`} name="cleaningGapDays" type="number" min={0} max={7} placeholder="0" />
          </label>
          <label>
            Chave Pix
            <input
              key={`pix-${unit.slug}`}
              name="pixKey"
              placeholder={unit.pixConfigured ? '••••••• (configurada)' : 'e-mail, CPF/CNPJ, telefone ou aleatória'}
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
            calendário abaixo. <strong>Folga entre hóspedes</strong> em 0 libera a virada no mesmo
            dia; em 1, o dia seguinte à saída sai do calendário. A chave Pix nunca é devolvida pela
            API depois de salva — só o QR gerado no servidor a usa.
          </p>
        </form>

        <form className="panel" onSubmit={blockDates}>
          <h2>Bloquear período</h2>
          <label>
            Início
            <input name="startDate" type="date" required />
          </label>
          <label>
            Liberação
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
            A data de liberação funciona como check-out: bloquear de 10 a 12 tira as noites 10 e
            11. O bloqueio some do calendário público sem revelar o motivo, e vale só para{' '}
            {unit.shortName}.
          </p>
        </form>
      </div>

      <RatePanel key={unit.slug} propertyId={unit.id} unitName={unit.shortName} />

      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
    </>
  );
}
