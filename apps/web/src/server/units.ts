import { query } from './db';
import { addDaysIso, todayIso } from './dates';
import { releaseExpiredHolds } from './inventory';
import { type PropertyRow, publicProperty } from './property';

/**
 * O negócio tem três espaços independentes (Flat Carneiros, Casa Térreo, Casa
 * 1º Andar). Alugar um não ocupa outro, então cada um tem calendário próprio —
 * a constraint de exclusão já é por `property_id` e cuida disso sozinha.
 *
 * Este módulo lê os três de uma vez: o calendário da vitrine precisa das três
 * linhas de disponibilidade na mesma resposta, e fazer N requisições por mês
 * exibido seria desperdício.
 */

const UNIT_COLUMNS = `
  id, name, slug, short_name, color, location_name, location_url, display_order,
  description, timezone, currency, check_in_time, check_in_until, check_out_time,
  cleaning_gap_hours, cleaning_gap_days, deposit_percentage, nightly_rate, min_nights, max_guests,
  booking_horizon_days, hold_minutes, terms_version, terms_content,
  pix_key, pix_holder_name, payment_instructions, hero_image_url, amenities`;

export type UnitRow = PropertyRow & {
  short_name: string | null;
  color: string | null;
  location_name: string | null;
  location_url: string | null;
  display_order: number;
};

export async function listUnits(): Promise<UnitRow[]> {
  const result = await query<UnitRow>(
    `SELECT ${UNIT_COLUMNS} FROM properties WHERE active = true
     ORDER BY display_order, name`
  );
  return result.rows;
}

/**
 * Uma noite está indisponível quando pertence a um bloqueio ativo da unidade.
 * Uma única consulta cobre todas as unidades e todo o intervalo.
 */
async function unavailableByUnit(from: string, to: string): Promise<Map<string, string[]>> {
  const result = await query<{ slug: string; day: string }>(
    `SELECT p.slug, to_char(d, 'YYYY-MM-DD') AS day
     FROM properties p
     CROSS JOIN generate_series($1::date, $2::date, interval '1 day') AS d
     WHERE p.active = true
       AND EXISTS (
         SELECT 1 FROM inventory_blocks b
         WHERE b.property_id = p.id AND b.active = true
           AND b.blocked_nights @> d::date
       )
     ORDER BY p.display_order, d`,
    [from, to]
  );

  const byUnit = new Map<string, string[]>();
  for (const row of result.rows) {
    const nights = byUnit.get(row.slug) ?? [];
    nights.push(row.day);
    byUnit.set(row.slug, nights);
  }
  return byUnit;
}

/** Tarifas de dia da semana e períodos de todas as unidades, em duas consultas. */
async function ratesByUnit(today: string) {
  const weekdays = await query<{
    property_id: string;
    weekday: number;
    nightly_amount: string;
    min_nights_on_arrival: number | null;
    bookable: boolean;
  }>(
    `SELECT w.property_id, w.weekday, w.nightly_amount, w.min_nights_on_arrival, w.bookable
     FROM rate_weekdays w JOIN properties p ON p.id = w.property_id
     WHERE p.active = true ORDER BY w.weekday`
  );
  const periods = await query<{
    property_id: string;
    name: string;
    starts_on: string;
    ends_on: string;
  }>(
    `SELECT r.property_id, r.name, r.starts_on::text AS starts_on, r.ends_on::text AS ends_on
     FROM rate_periods r JOIN properties p ON p.id = r.property_id
     WHERE p.active = true AND r.active = true AND r.ends_on >= $1::date
     ORDER BY r.starts_on`,
    [today]
  );

  const byUnit = new Map<
    string,
    {
      fromCents: number | null;
      weekdays: { weekday: number; nightlyCents: number; minNightsOnArrival: number | null }[];
      periods: { name: string; startsOn: string; endsOn: string }[];
    }
  >();

  const ensure = (propertyId: string) => {
    if (!byUnit.has(propertyId)) {
      byUnit.set(propertyId, { fromCents: null, weekdays: [], periods: [] });
    }
    return byUnit.get(propertyId)!;
  };

  for (const row of weekdays.rows) {
    const entry = ensure(row.property_id);
    const cents = Math.round(Number(row.nightly_amount) * 100);
    entry.weekdays.push({
      weekday: Number(row.weekday),
      nightlyCents: row.bookable ? cents : 0,
      minNightsOnArrival: row.min_nights_on_arrival
    });
    if (row.bookable && cents > 0) {
      entry.fromCents = entry.fromCents === null ? cents : Math.min(entry.fromCents, cents);
    }
  }
  for (const row of periods.rows) {
    ensure(row.property_id).periods.push({
      name: row.name,
      startsOn: row.starts_on,
      endsOn: row.ends_on
    });
  }
  return byUnit;
}

export type UnitCalendar = {
  from: string;
  to: string;
  units: (ReturnType<typeof publicProperty> & {
    shortName: string;
    color: string;
    locationName: string | null;
    locationUrl: string | null;
    unavailable: string[];
  })[];
};

const FALLBACK_COLOR = '#1F3A5F';

/**
 * Calendário completo da vitrine. `from`/`to` são datas civis; o padrão cobre
 * do dia de hoje até o horizonte de reservas da unidade mais permissiva.
 */
export async function unitCalendar(range?: { from?: string; to?: string }): Promise<UnitCalendar> {
  await releaseExpiredHolds();

  const units = await listUnits();
  if (!units.length) {
    const today = todayIso();
    return { from: range?.from ?? today, to: range?.to ?? today, units: [] };
  }

  // Fusos são iguais entre as unidades hoje, mas não assumimos: usa o "hoje"
  // mais cedo entre elas para não esconder um dia que ainda está à venda.
  const todays = units.map((unit) => todayIso(unit.timezone));
  const today = todays.sort()[0]!;
  const horizon = Math.max(...units.map((unit) => unit.booking_horizon_days));

  const from = range?.from ?? today;
  const to = range?.to ?? addDaysIso(from, horizon);

  const [unavailable, rates] = await Promise.all([unavailableByUnit(from, to), ratesByUnit(today)]);

  return {
    from,
    to,
    units: units.map((unit) => ({
      ...publicProperty(unit, rates.get(unit.id) ?? { fromCents: null, weekdays: [], periods: [] }),
      shortName: unit.short_name ?? unit.name,
      color: unit.color ?? FALLBACK_COLOR,
      locationName: unit.location_name,
      locationUrl: unit.location_url,
      unavailable: unavailable.get(unit.slug) ?? []
    }))
  };
}
