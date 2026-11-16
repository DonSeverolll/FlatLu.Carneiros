import { describe, expect, it } from 'vitest';
import { buscasProntas, descreverFiltros, linkGoogle, mesesAtras, montarConsulta } from './buscaGoogle';

describe('montarConsulta', () => {
  it('combina todos os operadores na ordem esperada', () => {
    const q = montarConsulta({
      termos: 'flat para alugar',
      exatas: ['Praia dos Carneiros'],
      alternativas: ['temporada', 'diária barata'],
      noTitulo: 'aluguel flat',
      naUrl: 'carneiros pe',
      sites: ['https://airbnb.com.br/', 'booking.com'],
      tipoArquivo: '.PDF',
      excluir: ['venda', 'flat-lu-carneiros.vercel.app', 'leilão judicial'],
      depoisDe: '2025-11-16',
      antesDe: '2026-11-16'
    });
    expect(q).toBe(
      'flat para alugar "Praia dos Carneiros" (temporada OR "diária barata") intitle:"aluguel flat" inurl:carneiros-pe ' +
        '(site:airbnb.com.br OR site:booking.com) filetype:pdf -venda -site:flat-lu-carneiros.vercel.app -"leilão judicial" ' +
        'after:2025-11-16 before:2026-11-16'
    );
  });

  it('ignora vazios e datas inválidas', () => {
    expect(montarConsulta({ exatas: ['', ' '], alternativas: ['única'], depoisDe: '16/11/2026' })).toBe('única');
    expect(montarConsulta({})).toBe('');
  });

  it('remove aspas digitadas dentro da frase exata', () => {
    expect(montarConsulta({ exatas: ['"Carneiros"'] })).toBe('"Carneiros"');
  });
});

describe('linkGoogle', () => {
  it('traduz aba, período, ao pé da letra e SafeSearch em parâmetros', () => {
    const url = new URL(
      linkGoogle('site:exemplo.com', { aba: 'imagens', periodo: 'ano', aoPeDaLetra: true, safe: 'desativado' })
    );
    expect(url.origin + url.pathname).toBe('https://www.google.com/search');
    expect(url.searchParams.get('q')).toBe('site:exemplo.com');
    expect(url.searchParams.get('tbm')).toBe('isch');
    expect(url.searchParams.get('tbs')).toBe('qdr:y,li:1');
    expect(url.searchParams.get('safe')).toBe('off');
  });

  it('web sem filtros não leva tbm nem tbs', () => {
    const url = new URL(linkGoogle('flat'));
    expect(url.searchParams.has('tbm')).toBe(false);
    expect(url.searchParams.has('tbs')).toBe(false);
  });
});

describe('descreverFiltros', () => {
  it('diz onde clicar no menu Ferramentas', () => {
    expect(descreverFiltros({ aba: 'noticias', periodo: 'mes', aoPeDaLetra: true })).toEqual([
      'Aba: Notícias',
      'Ferramentas › Em qualquer data › No último mês',
      'Ferramentas › Todos os resultados › Ao pé da letra',
      'SafeSearch: não precisa mudar'
    ]);
  });
});

describe('buscasProntas', () => {
  it('usa o host do site e a data de um ano atrás', () => {
    const grupos = buscasProntas('meusite.com.br', new Date('2026-11-16T12:00:00Z'));
    const todas = grupos.flatMap((g) => g.buscas.map((b) => montarConsulta(b.opcoes)));
    expect(todas[0]).toBe('site:meusite.com.br');
    expect(todas.some((q) => q.includes('after:2025-11-16'))).toBe(true);
    expect(todas.some((q) => q.includes('-site:meusite.com.br'))).toBe(true);
    expect(todas.every((q) => q.length > 0)).toBe(true);
  });

  it('mesesAtras volta o número certo de meses', () => {
    expect(mesesAtras(12, new Date('2026-02-28T00:00:00Z'))).toBe('2025-02-28');
  });
});
