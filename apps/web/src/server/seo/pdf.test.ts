import { describe, expect, it } from 'vitest';
import { gerarPdf, paraWinAnsi, quebrarLinhas } from './pdf';

const texto = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('gerarPdf', () => {
  const pdf = gerarPdf(
    [
      { tipo: 'titulo', texto: 'Guia da Praia dos Carneiros' },
      { tipo: 'texto', texto: 'Maré baixa — piscinas naturais (ação, região) \\ teste' },
      ...Array.from({ length: 80 }, (_, i) => ({
        tipo: 'texto' as const,
        texto: `Parágrafo ${i} com bastante texto para ocupar linhas.`
      }))
    ],
    { titulo: 'Guia ç', autor: 'Apt Carneiros', criadoEm: new Date('2026-11-16T00:00:00Z') }
  );
  const s = texto(pdf);

  it('tem cabeçalho, trailer e várias páginas', () => {
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const count = Number(/\/Count (\d+)/.exec(s)![1]);
    expect(count).toBeGreaterThan(1);
  });

  it('a tabela xref aponta para o início de cada objeto', () => {
    const inicio = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(inicio, inicio + 4)).toBe('xref');
    const total = Number(/xref\n0 (\d+)/.exec(s)![1]);
    const linhas = s.slice(inicio).split('\n').slice(3, 2 + total);
    expect(linhas.length).toBe(total - 1);
    linhas.forEach((linha, i) => {
      const offset = Number(linha.slice(0, 10));
      const esperado = `${i + 1} 0 obj`;
      expect(s.slice(offset, offset + esperado.length)).toBe(esperado);
    });
  });

  it('escapa parênteses e barra, e codifica acentos em octal WinAnsi', () => {
    expect(s).toContain('\\(a\\347\\343o, regi\\343o\\) \\\\ teste');
    expect(s).toContain('Mar\\351 baixa \\227 piscinas');
  });

  it('o Length de cada stream bate com o conteúdo', () => {
    for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const inicio = m.index! + m[0].length;
      expect(s.slice(inicio + Number(m[1]), inicio + Number(m[1]) + 10)).toBe('\nendstream');
    }
  });
});

describe('paraWinAnsi e quebrarLinhas', () => {
  it('troca o que não existe no WinAnsi por ?', () => {
    expect(paraWinAnsi('a€😀')).toEqual([0x61, 0x80, 0x3f]);
  });

  it('quebra em várias linhas sem perder palavra', () => {
    const frase = 'A Praia dos Carneiros fica no município de Tamandaré, no litoral sul de Pernambuco.';
    const linhas = quebrarLinhas(frase, 11, false, 150);
    expect(linhas.length).toBeGreaterThan(1);
    expect(linhas.join(' ')).toBe(frase);
  });
});
