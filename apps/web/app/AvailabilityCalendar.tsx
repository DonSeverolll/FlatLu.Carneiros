'use client';

import { useMemo, useState } from 'react';
import { WEEKDAY_SHORT, brl, monthGrid, monthLabel, shiftMonth } from '@/lib/format';
import type { UnitDto } from '@/lib/types';

type Props = {
  units: UnitDto[];
  /** Primeira data à venda; dias anteriores aparecem esmaecidos. */
  from: string;
  to: string;
  visible: Set<string>;
  onToggleVisible: (slug: string) => void;
  selectedUnit: string;
  onSelectUnit: (slug: string) => void;
  checkIn: string;
  checkOut: string;
  onPickDay: (day: string) => void;
};

/**
 * Calendário mensal com uma linha de cor por unidade — o mesmo formato do
 * material que a Lúcia já usa. Cada dia mostra, por unidade visível, se a
 * noite está livre (bolinha cheia) ou reservada (×).
 *
 * O filtro é local: alternar unidade é uma troca de visualização, não uma nova
 * consulta. O servidor já enviou as três disponibilidades.
 */
export default function AvailabilityCalendar({
  units,
  from,
  to,
  visible,
  onToggleVisible,
  selectedUnit,
  onSelectUnit,
  checkIn,
  checkOut,
  onPickDay
}: Props) {
  const [cursor, setCursor] = useState(() => {
    const [year, month] = from.split('-').map(Number);
    return { year, month };
  });

  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  // Conjuntos por unidade: lookup por noite em vez de varrer a lista.
  const blockedByUnit = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const unit of units) map.set(unit.slug, new Set(unit.unavailable));
    return map;
  }, [units]);

  const shownUnits = units.filter((unit) => visible.has(unit.slug));

  const canGoBack = `${cursor.year}-${String(cursor.month).padStart(2, '0')}` > from.slice(0, 7);
  const canGoForward = `${cursor.year}-${String(cursor.month).padStart(2, '0')}` < to.slice(0, 7);

  function move(delta: number) {
    setCursor((current) => shiftMonth(current.year, current.month, delta));
  }

  return (
    <div className="availability">
      <div className="availability-head">
        <div>
          <p className="eyebrow">Disponibilidade</p>
          <h2>Consulte as datas.</h2>
        </div>

        <ul className="unit-legend">
          {units.map((unit) => {
            const on = visible.has(unit.slug);
            return (
              <li key={unit.slug}>
                <button
                  aria-label={`${on ? 'Ocultar' : 'Mostrar'} ${unit.shortName} no calendário`}
                  aria-pressed={on}
                  className={on ? 'unit-chip on' : 'unit-chip'}
                  onClick={() => onToggleVisible(unit.slug)}
                  type="button"
                >
                  <i style={{ background: on ? unit.color : 'transparent', borderColor: unit.color }} />
                  <span>
                    <strong>{unit.shortName}</strong>
                    <small>Até {unit.maxGuests} pessoas</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="month-nav">
        <button type="button" onClick={() => move(-1)} disabled={!canGoBack} aria-label="Mês anterior">
          ‹
        </button>
        <strong>{monthLabel(cursor.year, cursor.month)}</strong>
        <button type="button" onClick={() => move(1)} disabled={!canGoForward} aria-label="Próximo mês">
          ›
        </button>
      </div>

      <div className="month-grid" role="grid">
        {WEEKDAY_SHORT.map((label) => (
          <div className="month-head" key={label} role="columnheader">
            {label}
          </div>
        ))}

        {cells.map((day, index) => {
          if (!day) return <div className="month-cell empty" key={`empty-${index}`} />;

          const past = day < from;
          const isEdge = day === checkIn || day === checkOut;
          const inRange = Boolean(checkIn && checkOut && day > checkIn && day < checkOut);
          const selectedBlocked = blockedByUnit.get(selectedUnit)?.has(day) ?? false;
          const clickable = !past && !selectedBlocked;

          return (
            <div
              className={`month-cell${past ? ' past' : ''}${isEdge ? ' edge' : ''}${inRange ? ' in-range' : ''}`}
              key={day}
              role="gridcell"
            >
              <button
                className="day-hit"
                disabled={!clickable}
                onClick={() => onPickDay(day)}
                type="button"
                aria-label={
                  `${Number(day.slice(-2))} de ${monthLabel(cursor.year, cursor.month)}: ` +
                  (shownUnits
                    .map(
                      (u) =>
                        `${u.shortName} ${
                          blockedByUnit.get(u.slug)?.has(day) ? 'reservado' : 'disponível'
                        }`
                    )
                    .join(', ') || 'nenhum espaço selecionado')
                }
              >
                <span className="day-number">{Number(day.slice(-2))}</span>
                <span className="day-marks">
                  {shownUnits.map((unit) => {
                    const blocked = blockedByUnit.get(unit.slug)?.has(day) ?? false;
                    return blocked ? (
                      <em className="mark taken" key={unit.slug} title={`${unit.shortName}: reservado`}>
                        ✕
                      </em>
                    ) : (
                      <em
                        className="mark free"
                        key={unit.slug}
                        style={{ background: unit.color }}
                        title={`${unit.shortName}: disponível`}
                      />
                    );
                  })}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="availability-foot">
        <p className="hint">
          <em className="mark free legend-dot" /> disponível &nbsp;·&nbsp;{' '}
          <em className="mark taken">✕</em> reservado
        </p>
        <p className="hint">
          Cada linha de cor é um dos espaços. Clique no dia para começar a reserva de{' '}
          <strong>{units.find((unit) => unit.slug === selectedUnit)?.shortName ?? '—'}</strong>.
        </p>
      </div>

      <div className="unit-cards">
        {units.map((unit) => (
          <button
            aria-label={`Reservar ${unit.shortName}, até ${unit.maxGuests} pessoas`}
            aria-pressed={unit.slug === selectedUnit}
            className={unit.slug === selectedUnit ? 'unit-card on' : 'unit-card'}
            key={unit.slug}
            onClick={() => onSelectUnit(unit.slug)}
            type="button"
            style={{ borderTopColor: unit.color }}
          >
            <strong>{unit.shortName}</strong>
            <span>Até {unit.maxGuests} pessoas</span>
            {unit.locationName && <span>{unit.locationName}</span>}
            <b>
              {unit.rates?.fromCents
                ? `a partir de ${brl(unit.rates.fromCents / 100)} a noite`
                : 'tarifa sob consulta'}
            </b>
          </button>
        ))}
      </div>
    </div>
  );
}
