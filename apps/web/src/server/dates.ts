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

/**
 * Número de noites entre duas datas civis. Negativo se invertidas.
 *
 * `Date.UTC` recebe o mês em base ZERO. Espalhar [ano, mês, dia] direto nele
 * desloca as duas datas um mês para a frente — o que passa despercebido
 * enquanto ambas caem no mesmo mês, porque o deslocamento se cancela na
 * subtração, e erra quando a estadia cruza a virada entre meses de tamanhos
 * diferentes. 28/06 a 01/07 virava 4 noites em vez de 3.
 */
function utcDeIso(iso: string): number {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return Date.UTC(ano!, mes! - 1, dia!);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((utcDeIso(checkOut) - utcDeIso(checkIn)) / 86_400_000);
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
