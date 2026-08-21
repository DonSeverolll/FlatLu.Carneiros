'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/api';
import { brl, shortDate } from '@/lib/format';

type WeekdayRateRow = {
  weekday: number;
  nightly_amount: string;
  min_nights_on_arrival: number | null;
  arrival_allowed: boolean;
  bookable: boolean;
};

type PeriodRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  nightly_amount: string | null;
  package_amount: string | null;
  min_nights: number | null;
  requires_full_period: boolean;
  priority: number;
  active: boolean;
};

const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Estado local de edição, para não perder o que foi digitado a cada render. */
type Draft = {
  nightlyAmount: string;
  minNightsOnArrival: string;
  bookable: boolean;
  arrivalAllowed: boolean;
};

const emptyDraft: Draft = {
  nightlyAmount: '0',
  minNightsOnArrival: '',
  bookable: true,
  arrivalAllowed: true
};

export default function RatePanel({ propertyId }: { propertyId: string }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => WEEKDAY_NAMES.map(() => ({ ...emptyDraft })));
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [priceMode, setPriceMode] = useState<'NIGHTLY' | 'PACKAGE'>('PACKAGE');

  const load = useCallback(async () => {
    try {
      const [weekdays, periodList] = await Promise.all([
        api<{ rates: WeekdayRateRow[] }>(`/api/admin/properties/${propertyId}/rates/weekdays`),
        api<{ periods: PeriodRow[] }>(`/api/admin/properties/${propertyId}/rates/periods`)
      ]);
      setDrafts(
        WEEKDAY_NAMES.map((_, weekday) => {
          const row = weekdays.rates.find((rate) => Number(rate.weekday) === weekday);
          if (!row) return { ...emptyDraft };
          return {
            nightlyAmount: Number(row.nightly_amount).toFixed(2),
            minNightsOnArrival: row.min_nights_on_arrival ? String(row.min_nights_on_arrival) : '',
            bookable: row.bookable,
            arrivalAllowed: row.arrival_allowed
          };
        })
      );
      setPeriods(periodList.periods.filter((period) => period.active));
    } catch (error) {
      setMessage(messageFor(error));
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDraft(weekday: number, patch: Partial<Draft>) {
    setDrafts((current) =>
      current.map((draft, index) => (index === weekday ? { ...draft, ...patch } : draft))
    );
  }

  async function saveWeekdays() {
    setBusy('weekdays');
    setMessage('');
    try {
      await api(`/api/admin/properties/${propertyId}/rates/weekdays`, {
        method: 'PUT',
        body: {
          rates: drafts.map((draft, weekday) => ({
            weekday,
            nightlyAmount: Number(draft.nightlyAmount.replace(',', '.')) || 0,
            minNightsOnArrival: draft.minNightsOnArrival
              ? Number(draft.minNightsOnArrival)
              : null,
            bookable: draft.bookable,
            arrivalAllowed: draft.arrivalAllowed
          }))
        }
      });
      setMessage('Tarifas por dia da semana salvas.');
      await load();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  async function createPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(String(form.get('amount') ?? '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage('Informe um valor válido.');
      return;
    }
    setBusy('period');
    setMessage('');
    try {
      await api(`/api/admin/properties/${propertyId}/rates/periods`, {
        method: 'POST',
        body: {
          name: form.get('name'),
          startsOn: form.get('startsOn'),
          endsOn: form.get('endsOn'),
          // Pacote = valor fechado do bloco; por noite = multiplica.
          ...(priceMode === 'PACKAGE' ? { packageAmount: amount } : { nightlyAmount: amount }),
          minNights: form.get('minNights') ? Number(form.get('minNights')) : null,
          priority: form.get('priority') ? Number(form.get('priority')) : 100
        }
      });
      setMessage('Período criado.');
      (event.target as HTMLFormElement).reset();
      await load();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  async function removePeriod(period: PeriodRow) {
    if (!window.confirm(`Desativar o período "${period.name}"?`)) return;
    setBusy(period.id);
    try {
      await api(`/api/admin/properties/${propertyId}/rates/periods/${period.id}`, {
        method: 'DELETE'
      });
      setMessage('Período desativado.');
      await load();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="admin-heading">
          <h2>Tarifa por dia da semana</h2>
          <button
            className="button button-small"
            type="button"
            onClick={() => void saveWeekdays()}
            disabled={busy === 'weekdays'}
          >
            {busy === 'weekdays' ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
        <div className="rate-grid">
          {WEEKDAY_NAMES.map((name, weekday) => (
            <label key={name}>
              {name}
              <input
                inputMode="decimal"
                value={drafts[weekday]?.nightlyAmount ?? '0'}
                onChange={(event) => updateDraft(weekday, { nightlyAmount: event.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="rate-grid">
          {WEEKDAY_NAMES.map((name, weekday) => (
            <label key={`min-${name}`}>
              Mín. noites p/ entrada {name.slice(0, 3).toLowerCase()}
              <input
                type="number"
                min={1}
                max={90}
                placeholder="—"
                value={drafts[weekday]?.minNightsOnArrival ?? ''}
                onChange={(event) =>
                  updateDraft(weekday, { minNightsOnArrival: event.target.value })
                }
              />
            </label>
          ))}
        </div>
        <p className="hint">
          Um dia com tarifa <strong>0</strong> não é vendido: a vitrine mostra
          &ldquo;sob consulta&rdquo; e a API recusa a reserva. A estadia mínima por dia de entrada
          é o que impede vender uma noite solta — deixe em branco para usar o mínimo geral do
          imóvel.
        </p>
      </section>

      <section className="panel">
        <h2>Períodos especiais</h2>
        {periods.length ? (
          periods.map((period) => (
            <div className="period-row" key={period.id}>
              <div>
                <strong>{period.name}</strong>
                <span>
                  {shortDate(period.starts_on)} a {shortDate(period.ends_on)} ·{' '}
                  {period.package_amount
                    ? `pacote ${brl(period.package_amount)}`
                    : `${brl(period.nightly_amount ?? '0')} a noite`}
                  {period.min_nights ? ` · mín. ${period.min_nights} noites` : ''}
                  {period.priority !== 100 ? ` · prioridade ${period.priority}` : ''}
                </span>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => void removePeriod(period)}
                disabled={busy === period.id}
              >
                Desativar
              </button>
            </div>
          ))
        ) : (
          <p className="hint">Nenhum período especial. Natal, Réveillon e feriados entram aqui.</p>
        )}

        <form onSubmit={createPeriod}>
          <h2 style={{ fontSize: 22, marginTop: 34 }}>Novo período</h2>
          <label>
            Nome
            <input name="name" required minLength={2} maxLength={80} placeholder="Réveillon 2026" />
          </label>
          <div className="rate-grid">
            <label>
              Primeira noite
              <input name="startsOn" type="date" required />
            </label>
            <label>
              Última noite
              <input name="endsOn" type="date" required />
            </label>
          </div>
          <p className="hint">
            A saída é sempre o dia seguinte à última noite. Réveillon de 30/12 a 01/01 significa
            check-out em 02/01.
          </p>
          <div className="rate-grid">
            <label>
              Cobrança
              <select
                value={priceMode}
                onChange={(event) => setPriceMode(event.target.value as 'NIGHTLY' | 'PACKAGE')}
              >
                <option value="PACKAGE">Pacote fechado</option>
                <option value="NIGHTLY">Por noite</option>
              </select>
            </label>
            <label>
              Valor (R$)
              <input name="amount" inputMode="decimal" required placeholder="2500" />
            </label>
            <label>
              Mín. noites
              <input name="minNights" type="number" min={1} max={90} placeholder="—" />
            </label>
            <label>
              Prioridade
              <input name="priority" type="number" min={1} max={1000} placeholder="100" />
            </label>
          </div>
          <p className="hint">
            <strong>Pacote fechado</strong> cobra o valor uma vez e exige a estadia inteira — é o
            caso de Réveillon e feriado prolongado. <strong>Por noite</strong> multiplica pelas
            noites usadas. A prioridade decide quem vence quando dois períodos se sobrepõem (maior
            ganha); dois períodos de mesma prioridade não podem se sobrepor, o banco recusa.
          </p>
          <button className="button" type="submit" disabled={busy === 'period'}>
            {busy === 'period' ? 'Criando...' : 'Criar período'}
          </button>
        </form>
      </section>

      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
    </>
  );
}
