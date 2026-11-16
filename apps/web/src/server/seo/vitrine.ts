import { catalogoPublico, type CatalogoEspaco } from '@/server/catalogo/catalogo';
import { unitCalendar } from '@/server/units';
import type { UnitCalendarDto } from '@/lib/types';

/**
 * Dados das páginas públicas (vitrine, página de cada espaço, guia, sitemap).
 * Se o banco estiver fora, as páginas continuam no ar em modo degradado — o
 * Google não pode encontrar um erro 500 no lugar do conteúdo.
 */
export async function carregarCalendario(): Promise<{ calendar: UnitCalendarDto | null; error: string | null }> {
  try {
    const calendar = await unitCalendar();
    if (!calendar.units.length) {
      return { calendar: null, error: 'Nenhum espaço publicado no momento.' };
    }
    return { calendar: calendar as UnitCalendarDto, error: null };
  } catch (error) {
    console.error('[vitrine]', error);
    return { calendar: null, error: 'Calendário temporariamente indisponível.' };
  }
}

/** Catálogo é enfeite: se falhar, a página segue sem ele. */
export async function carregarCatalogo(): Promise<{ espacos: CatalogoEspaco[]; conta: string | null }> {
  try {
    return await catalogoPublico();
  } catch (error) {
    console.error('[catalogo]', error);
    return { espacos: [], conta: null };
  }
}

export async function carregarVitrine() {
  const [{ calendar, error }, catalogo] = await Promise.all([carregarCalendario(), carregarCatalogo()]);
  return { calendar, error, catalogo };
}

/** Fotos do espaço no catálogo (só as aprovadas pelo admin). */
export function fotosDoEspaco(catalogo: { espacos: CatalogoEspaco[] }, slug: string) {
  return catalogo.espacos.find((e) => e.slug === slug)?.fotos ?? [];
}
