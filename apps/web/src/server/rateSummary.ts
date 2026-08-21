import { loadRateCalendar } from './rateStore';
import type { RateSummary } from './property';
import { todayIso } from './dates';

/**
 * Resumo público do calendário: o suficiente para a vitrine dizer "a partir de
 * R$ X" e listar os períodos com nome, sem revelar valores de pacote antes de
 * o hóspede escolher as datas.
 */
export async function publicRateSummary(
  propertyId: string,
  timezone: string
): Promise<RateSummary> {
  const calendar = await loadRateCalendar(propertyId);
  const bookable = calendar.weekdays.filter((rate) => rate.bookable && rate.nightlyCents > 0);
  const today = todayIso(timezone);

  return {
    fromCents: bookable.length ? Math.min(...bookable.map((rate) => rate.nightlyCents)) : null,
    weekdays: calendar.weekdays.map((rate) => ({
      weekday: rate.weekday,
      nightlyCents: rate.bookable ? rate.nightlyCents : 0,
      minNightsOnArrival: rate.minNightsOnArrival
    })),
    // Períodos já encerrados só poluiriam a vitrine.
    periods: calendar.periods
      .filter((period) => period.endsOn >= today)
      .map((period) => ({ name: period.name, startsOn: period.startsOn, endsOn: period.endsOn }))
  };
}
