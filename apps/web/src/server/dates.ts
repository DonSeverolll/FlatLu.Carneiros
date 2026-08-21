/**
 * Datas de estadia são civis, não instantes. Toda a camada trata `check_in` e
 * `check_out` como strings `YYYY-MM-DD` e nunca converte para `Date` antes de
 * enviar ao banco — era exatamente essa conversão (`Date.toISOString()` seguido
 * de cast `::date`) que fazia o resultado depender do `TimeZone` da sessão.
 */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Número de noites entre duas datas civis. Negativo se invertidas. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.UTC(...(checkIn.split('-').map(Number) as [number, number, number]));
  const end = Date.UTC(...(checkOut.split('-').map(Number) as [number, number, number]));
  return Math.round((end - start) / 86_400_000);
}

export function addDaysIso(date: string, amount: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return shifted.toISOString().slice(0, 10);
}

/** Data civil de hoje no fuso informado (ex.: America/Recife). */
export function todayIso(timeZone = 'America/Recife', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}
