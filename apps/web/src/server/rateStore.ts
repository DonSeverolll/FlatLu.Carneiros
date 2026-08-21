import { z } from 'zod';
import type { PoolClient } from 'pg';
import { query, violatedConstraint } from './db';
import { conflict, notFound } from './errors';
import { isIsoDate } from './dates';
import type { RatePeriod, WeekdayRate } from './rates';

const toCents = (numeric: string | null): number =>
  numeric === null ? 0 : Math.round(Number(numeric) * 100);

export type RateCalendar = { weekdays: WeekdayRate[]; periods: RatePeriod[] };

/**
 * Lê o calendário inteiro numa ida ao banco. Períodos são poucos (dezenas por
 * ano) e as tarifas de dia da semana são no máximo sete, então filtrar por
 * intervalo aqui só complicaria o cálculo sem ganho real.
 */
export async function loadRateCalendar(
  propertyId: string,
  client?: PoolClient
): Promise<RateCalendar> {
  const runner = client ? client.query.bind(client) : query;

  const weekdayRows = await runner(
    `SELECT weekday, nightly_amount, min_nights_on_arrival, arrival_allowed, bookable
     FROM rate_weekdays WHERE property_id = $1 ORDER BY weekday`,
    [propertyId]
  );
  const periodRows = await runner(
    `SELECT id, name, starts_on::text AS starts_on, ends_on::text AS ends_on,
            nightly_amount, package_amount, min_nights, requires_full_period, priority
     FROM rate_periods WHERE property_id = $1 AND active = true
     ORDER BY priority DESC, starts_on`,
    [propertyId]
  );

  return {
    weekdays: weekdayRows.rows.map((row: Record<string, unknown>) => ({
      weekday: Number(row.weekday),
      nightlyCents: toCents(row.nightly_amount as string),
      minNightsOnArrival:
        row.min_nights_on_arrival === null ? null : Number(row.min_nights_on_arrival),
      arrivalAllowed: Boolean(row.arrival_allowed),
      bookable: Boolean(row.bookable)
    })),
    periods: periodRows.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      name: String(row.name),
      startsOn: String(row.starts_on),
      endsOn: String(row.ends_on),
      nightlyCents: row.nightly_amount === null ? null : toCents(row.nightly_amount as string),
      packageCents: row.package_amount === null ? null : toCents(row.package_amount as string),
      minNights: row.min_nights === null ? null : Number(row.min_nights),
      requiresFullPeriod: Boolean(row.requires_full_period),
      priority: Number(row.priority)
    }))
  };
}

// ---------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------

const isoDate = z.string().refine(isIsoDate, 'Use o formato YYYY-MM-DD');

export const weekdayRatesSchema = z.object({
  rates: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        nightlyAmount: z.number().nonnegative().max(1_000_000),
        minNightsOnArrival: z.number().int().min(1).max(90).nullable().optional(),
        arrivalAllowed: z.boolean().optional(),
        bookable: z.boolean().optional()
      })
    )
    .min(1)
    .max(7)
});

export const ratePeriodSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    startsOn: isoDate,
    endsOn: isoDate,
    nightlyAmount: z.number().nonnegative().max(1_000_000).nullable().optional(),
    packageAmount: z.number().nonnegative().max(1_000_000).nullable().optional(),
    minNights: z.number().int().min(1).max(90).nullable().optional(),
    requiresFullPeriod: z.boolean().optional(),
    priority: z.number().int().min(1).max(1000).optional()
  })
  .refine((value) => value.endsOn >= value.startsOn, 'endsOn deve ser igual ou depois de startsOn')
  .refine(
    (value) =>
      (value.nightlyAmount === null || value.nightlyAmount === undefined) !==
      (value.packageAmount === null || value.packageAmount === undefined),
    'Informe nightlyAmount OU packageAmount, nunca os dois'
  );

export async function replaceWeekdayRates(
  propertyId: string,
  input: z.infer<typeof weekdayRatesSchema>
) {
  for (const rate of input.rates) {
    await query(
      `INSERT INTO rate_weekdays
         (property_id, weekday, nightly_amount, min_nights_on_arrival, arrival_allowed, bookable, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, true), COALESCE($6, true), now())
       ON CONFLICT (property_id, weekday) DO UPDATE
         SET nightly_amount = EXCLUDED.nightly_amount,
             min_nights_on_arrival = EXCLUDED.min_nights_on_arrival,
             arrival_allowed = EXCLUDED.arrival_allowed,
             bookable = EXCLUDED.bookable,
             updated_at = now()`,
      [
        propertyId,
        rate.weekday,
        rate.nightlyAmount.toFixed(2),
        rate.minNightsOnArrival ?? null,
        rate.arrivalAllowed ?? null,
        rate.bookable ?? null
      ]
    );
  }
  return listWeekdayRates(propertyId);
}

export async function listWeekdayRates(propertyId: string) {
  const result = await query(
    `SELECT weekday, nightly_amount, min_nights_on_arrival, arrival_allowed, bookable
     FROM rate_weekdays WHERE property_id = $1 ORDER BY weekday`,
    [propertyId]
  );
  return result.rows;
}

export async function listRatePeriods(propertyId: string) {
  const result = await query(
    `SELECT id, name, starts_on::text AS starts_on, ends_on::text AS ends_on,
            nightly_amount, package_amount, min_nights, requires_full_period,
            priority, active
     FROM rate_periods WHERE property_id = $1
     ORDER BY starts_on, priority DESC`,
    [propertyId]
  );
  return result.rows;
}

export async function createRatePeriod(
  propertyId: string,
  input: z.infer<typeof ratePeriodSchema>
) {
  // Pacote sem exigir o bloco inteiro seria rateado de forma arbitrária; a
  // constraint do banco recusa, então normalizamos aqui.
  const requiresFullPeriod =
    input.packageAmount !== null && input.packageAmount !== undefined
      ? true
      : (input.requiresFullPeriod ?? false);

  try {
    const result = await query(
      `INSERT INTO rate_periods
         (property_id, name, starts_on, ends_on, nightly_amount, package_amount,
          min_nights, requires_full_period, priority)
       VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, COALESCE($9, 100))
       RETURNING id, name, starts_on::text AS starts_on, ends_on::text AS ends_on,
                 nightly_amount, package_amount, min_nights, requires_full_period,
                 priority, active`,
      [
        propertyId,
        input.name,
        input.startsOn,
        input.endsOn,
        input.nightlyAmount?.toFixed(2) ?? null,
        input.packageAmount?.toFixed(2) ?? null,
        input.minNights ?? null,
        requiresFullPeriod,
        input.priority ?? null
      ]
    );
    return result.rows[0];
  } catch (error) {
    if (violatedConstraint(error) === 'rate_periods_no_overlap') {
      throw conflict('PERIOD_OVERLAPS_EXISTING');
    }
    throw error;
  }
}

export async function deleteRatePeriod(propertyId: string, periodId: string) {
  // Desativa em vez de apagar: reservas antigas guardam o nome do período no
  // extrato, e o histórico precisa continuar explicável.
  const result = await query(
    `UPDATE rate_periods SET active = false, updated_at = now()
     WHERE id = $1 AND property_id = $2 AND active = true
     RETURNING id, name`,
    [periodId, propertyId]
  );
  if (!result.rowCount) throw notFound('RATE_PERIOD_NOT_FOUND');
  return result.rows[0];
}
