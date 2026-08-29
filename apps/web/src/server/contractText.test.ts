import { describe, expect, it } from 'vitest';
import {
  dataPorExtenso,
  marcadoresDoModelo,
  moedaBRL,
  numeroPorExtenso,
  preencherModelo,
  valorPorExtenso
} from './contractText';

describe('numeroPorExtenso', () => {
  it('cobre unidades, dezenas e a irregularidade do cem', () => {
    expect(numeroPorExtenso(0)).toBe('zero');
    expect(numeroPorExtenso(7)).toBe('sete');
    expect(numeroPorExtenso(14)).toBe('catorze');
    expect(numeroPorExtenso(31)).toBe('trinta e um');
    expect(numeroPorExtenso(100)).toBe('cem');
    expect(numeroPorExtenso(101)).toBe('cento e um');
    expect(numeroPorExtenso(258)).toBe('duzentos e cinquenta e oito');
    expect(numeroPorExtenso(999)).toBe('novecentos e noventa e nove');
  });

  it('usa "um mil", como o modelo do escritório', () => {
    expect(numeroPorExtenso(1000)).toBe('um mil');
    expect(numeroPorExtenso(1400)).toBe('um mil e quatrocentos');
    expect(numeroPorExtenso(2800)).toBe('dois mil e oitocentos');
  });

  it('escolhe entre "e" e vírgula conforme o resto', () => {
    // Resto redondo ou menor que cem leva "e"; o resto leva vírgula.
    expect(numeroPorExtenso(1200)).toBe('um mil e duzentos');
    expect(numeroPorExtenso(1020)).toBe('um mil e vinte');
    expect(numeroPorExtenso(1234)).toBe('um mil, duzentos e trinta e quatro');
    expect(numeroPorExtenso(8000)).toBe('oito mil');
  });

  it('chega a milhões', () => {
    expect(numeroPorExtenso(1_000_000)).toBe('um milhão');
    expect(numeroPorExtenso(2_500_000)).toBe('dois milhões e quinhentos mil');
  });

  it('recusa entrada inválida em vez de produzir texto errado', () => {
    expect(() => numeroPorExtenso(-1)).toThrow();
    expect(() => numeroPorExtenso(1.5)).toThrow();
    expect(() => numeroPorExtenso(1_000_000_000)).toThrow();
  });
});

describe('valorPorExtenso', () => {
  it('reproduz os valores do contrato modelo', () => {
    expect(valorPorExtenso(280_000)).toBe('dois mil e oitocentos reais');
    expect(valorPorExtenso(140_000)).toBe('um mil e quatrocentos reais');
    expect(valorPorExtenso(25_831)).toBe(
      'duzentos e cinquenta e oito reais e trinta e um centavos'
    );
  });

  it('acerta singular e valores só de centavos', () => {
    expect(valorPorExtenso(100)).toBe('um real');
    expect(valorPorExtenso(101)).toBe('um real e um centavo');
    expect(valorPorExtenso(50)).toBe('cinquenta centavos');
    expect(valorPorExtenso(0)).toBe('zero reais');
  });
});

describe('moedaBRL', () => {
  it('formata com separador de milhar', () => {
    expect(moedaBRL(280_000)).toBe('R$ 2.800,00');
    expect(moedaBRL(190_000)).toBe('R$ 1.900,00');
    expect(moedaBRL(5)).toBe('R$ 0,05');
    expect(moedaBRL(100_000_00)).toBe('R$ 100.000,00');
  });
});

describe('dataPorExtenso', () => {
  it('escreve a data sem depender do fuso da máquina', () => {
    expect(dataPorExtenso('2026-12-31')).toBe('31 de dezembro de 2026');
    expect(dataPorExtenso('2027-01-03')).toBe('03 de janeiro de 2027');
    expect(dataPorExtenso('2026-03-01')).toBe('01 de março de 2026');
  });

  it('recusa data inválida', () => {
    expect(() => dataPorExtenso('2026-13-01')).toThrow();
    expect(() => dataPorExtenso('nada')).toThrow();
  });
});

describe('preencherModelo', () => {
  it('substitui os marcadores', () => {
    const texto = preencherModelo('Olá {{nome}}, CPF {{cpf}}.', {
      nome: 'Stephany',
      cpf: '103.352.634-70'
    });
    expect(texto).toBe('Olá Stephany, CPF 103.352.634-70.');
  });

  it('aceita espaços dentro do marcador', () => {
    expect(preencherModelo('{{ nome }}', { nome: 'Lúcia' })).toBe('Lúcia');
  });

  it('recusa emitir com marcador vazio, em vez de deixar buraco no contrato', () => {
    // Um contrato com "residente na , /, CEP" é pior que contrato nenhum.
    expect(() => preencherModelo('na {{endereco}}, {{cidade}}', { endereco: 'Rua X' })).toThrow(
      'CONTRACT_VARIABLES_MISSING'
    );
    expect(() => preencherModelo('{{nome}}', { nome: '   ' })).toThrow();
  });

  it('lista tudo que faltou, não só o primeiro', () => {
    try {
      preencherModelo('{{a}} {{b}} {{c}}', { b: 'ok' });
      throw new Error('deveria ter falhado');
    } catch (error) {
      expect((error as { missing: string[] }).missing).toEqual(['a', 'c']);
    }
  });
});

describe('marcadoresDoModelo', () => {
  it('lista os marcadores sem repetir', () => {
    expect(marcadoresDoModelo('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });
});
