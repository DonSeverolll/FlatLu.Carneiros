import { query } from './db';
import { notFound } from './errors';
import { addDaysIso, todayIso } from './dates';
import { releaseExpiredHolds } from './inventory';

export type PropertyRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  timezone: string;
  currency: string;
  check_in_time: string;
  check_out_time: string;
  cleaning_gap_hours: number;
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
  id, name, slug, description, timezone, currency, check_in_time, check_out_time,
  cleaning_gap_hours, deposit_percentage, nightly_rate, min_nights, max_guests,
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

/** Vitrine pública: nunca expõe chave Pix nem termos completos. */
export function publicProperty(property: PropertyRow) {
  return {
    id: property.id,
    name: property.name,
    slug: property.slug,
    description: property.description,
    currency: property.currency,
    timezone: property.timezone,
    checkInTime: property.check_in_time,
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
    /** Enquanto a diária não for publicada, o site não inventa preço. */
    ratePublished: Number(property.nightly_rate) > 0
  };
}

/**
 * Uma noite `d` está indisponível quando a janela real de ocupação
 * `[d + check_in_time, d+1 + check_out_time + faxina)` colide com algum bloqueio
 * ativo. Calcular isso no banco — e não no navegador — evita que o front-end
 * erre por fuso ou por desconhecer o intervalo de limpeza.
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
         AND b.blocked_period && tstzrange(
           ((d::date + $4::time) AT TIME ZONE $6),
           (((d::date + 1) + $5::time) AT TIME ZONE $6) + ($7::int * interval '1 hour'),
           '[)'
         )
     )
     ORDER BY d`,
    [
      property.id,
      from,
      to,
      property.check_in_time,
      property.check_out_time,
      property.timezone,
      property.cleaning_gap_hours
    ]
  );

  return { from, to, unavailable: result.rows.map((row) => row.day) };
}

/** Verifica se um intervalo específico está livre, sem revelar o calendário. */
export async function rangeIsFree(propertyId: string, checkIn: string, checkOut: string) {
  const result = await query<{ blocked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM inventory_blocks b
       JOIN properties p ON p.id = b.property_id
       WHERE b.property_id = $1 AND b.active = true
         AND b.blocked_period && tstzrange(
           (($2::date + p.check_in_time) AT TIME ZONE p.timezone),
           (($3::date + p.check_out_time) AT TIME ZONE p.timezone),
           '[)'
         )
     ) AS blocked`,
    [propertyId, checkIn, checkOut]
  );
  return !result.rows[0]?.blocked;
}
