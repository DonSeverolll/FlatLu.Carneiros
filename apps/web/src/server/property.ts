import { query } from './db';
import { notFound } from './errors';
import { addDaysIso, todayIso } from './dates';
import { releaseExpiredHolds } from './inventory';

export type PropertyRow = {
  id: string;
  name: string;
  slug: string;
  short_name?: string | null;
  color?: string | null;
  location_name?: string | null;
  location_url?: string | null;
  description: string;
  timezone: string;
  currency: string;
  check_in_time: string;
  check_in_until: string;
  check_out_time: string;
  cleaning_gap_hours: number;
  cleaning_gap_days: number;
  deposit_percentage: string;
  nightly_rate: string;
  min_nights: number;
  max_guests: number;
  booking_horizon_days: number;
  hold_minutes: number;
  terms_version: string;
  terms_content: string;
  pix_key: string | null;
  pix_holder_name: string | null;
  payment_instructions: string | null;
  hero_image_url: string | null;
  amenities: string[];
};

const PROPERTY_COLUMNS = `
  id, name, slug, short_name, color, location_name, location_url,
  description, timezone, currency, check_in_time, check_in_until, check_out_time,
  cleaning_gap_hours, cleaning_gap_days, deposit_percentage, nightly_rate, min_nights, max_guests,
  booking_horizon_days, hold_minutes, terms_version, terms_content,
  pix_key, pix_holder_name, payment_instructions, hero_image_url, amenities`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aceita slug ou UUID: o front-end nunca precisa de dois roundtrips. */
export async function findProperty(idOrSlug: string): Promise<PropertyRow> {
  const result = await query<PropertyRow>(
    `SELECT ${PROPERTY_COLUMNS} FROM properties
     WHERE active = true AND (${UUID.test(idOrSlug) ? 'id = $1' : 'slug = $1'})`,
    [idOrSlug]
  );
  const property = result.rows[0];
  if (!property) throw notFound('PROPERTY_NOT_FOUND');
  return property;
}

export type RateSummary = {
  /** Menor tarifa publicada, para o "a partir de" da vitrine. */
  fromCents: number | null;
  weekdays: { weekday: number; nightlyCents: number; minNightsOnArrival: number | null }[];
  periods: { name: string; startsOn: string; endsOn: string }[];
};

/** Vitrine pública: nunca expõe chave Pix. */
export function publicProperty(property: PropertyRow, rates?: RateSummary) {
  /**
   * `ratePublished` deixou de ser "nightly_rate > 0": com calendário de
   * tarifas, basta existir uma tarifa de dia da semana. A diária da
   * propriedade segue como fallback para dias sem regra.
   */
  const ratePublished =
    Number(property.nightly_rate) > 0 || (rates?.fromCents ?? 0) > 0;

  return {
    id: property.id,
    name: property.name,
    slug: property.slug,
    shortName: property.short_name ?? property.name,
    color: property.color ?? '#1F3A5F',
    locationName: property.location_name ?? null,
    locationUrl: property.location_url ?? null,
    description: property.description,
    currency: property.currency,
    timezone: property.timezone,
    checkInTime: property.check_in_time,
    checkInUntil: property.check_in_until,
    checkOutTime: property.check_out_time,
    nightlyRate: property.nightly_rate,
    depositPercentage: property.deposit_percentage,
    minNights: property.min_nights,
    maxGuests: property.max_guests,
    bookingHorizonDays: property.booking_horizon_days,
    holdMinutes: property.hold_minutes,
    termsVersion: property.terms_version,
    termsContent: property.terms_content,
    heroImageUrl: property.hero_image_url,
    amenities: property.amenities,
    ratePublished,
    /** Booleano, nunca a chave: o painel precisa saber se dá para cobrar. */
    pixConfigured: Boolean(property.pix_key),
    /** Só a estrutura de preços; o valor de uma estadia vem de /quote. */
    rates: rates ?? null
  };
}

/**
 * Uma noite `d` está indisponível quando pertence a algum bloqueio ativo. Com
 * estoque por noite a comparação é direta — `d <@ blocked_nights` — e não
 * depende de horário nem de fuso.
 */
export async function unavailableNights(
  property: PropertyRow,
  range?: { from?: string; to?: string }
) {
  await releaseExpiredHolds();

  const from = range?.from ?? todayIso(property.timezone);
  const to = range?.to ?? addDaysIso(from, property.booking_horizon_days);

  const result = await query<{ day: string }>(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day
     FROM generate_series($2::date, $3::date, interval '1 day') AS d
     WHERE EXISTS (
       SELECT 1 FROM inventory_blocks b
       WHERE b.property_id = $1 AND b.active = true
         AND b.blocked_nights @> d::date
     )
     ORDER BY d`,
    [property.id, from, to]
  );

  return { from, to, unavailable: result.rows.map((row) => row.day) };
}

/** Verifica se um intervalo específico está livre, sem revelar o calendário. */
export async function rangeIsFree(propertyId: string, checkIn: string, checkOut: string) {
  const result = await query<{ blocked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM inventory_blocks b
       WHERE b.property_id = $1 AND b.active = true
         AND b.blocked_nights && daterange($2::date, $3::date, '[)')
     ) AS blocked`,
    [propertyId, checkIn, checkOut]
  );
  return !result.rows[0]?.blocked;
}
