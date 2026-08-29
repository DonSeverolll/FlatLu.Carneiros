/**
 * Texto do contrato: preenchimento de marcadores, datas por extenso e valor
 * por extenso. Tudo puro — o instrumento é documento jurídico e o que ele diz
 * precisa ser reproduzível e testável sem banco.
 */

const UNIDADES = [
  '', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete',
  'dezoito', 'dezenove'
];
const DEZENAS = [
  '', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta',
  'oitenta', 'noventa'
];
const CENTENAS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos'
];

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

/** 0–999 por extenso. */
function ateNovecentos(valor: number): string {
  if (valor === 0) return '';
  if (valor === 100) return 'cem';
  if (valor < 20) return UNIDADES[valor]!;

  if (valor < 100) {
    const dezena = Math.floor(valor / 10);
    const unidade = valor % 10;
    return unidade ? `${DEZENAS[dezena]} e ${UNIDADES[unidade]}` : DEZENAS[dezena]!;
  }

  const centena = Math.floor(valor / 100);
  const resto = valor % 100;
  return resto ? `${CENTENAS[centena]} e ${ateNovecentos(resto)}` : CENTENAS[centena]!;
}

/**
 * Liga milhar e resto. Em português o "e" entra quando o resto é menor que cem
 * ou é centena redonda — "um mil e quatrocentos", mas "um mil, duzentos e
 * trinta e quatro".
 */
function ligarMilhar(milhar: string, resto: number): string {
  if (!resto) return milhar;
  const conector = resto < 100 || resto % 100 === 0 ? ' e ' : ', ';
  return `${milhar}${conector}${ateNovecentos(resto)}`;
}

export function numeroPorExtenso(valor: number): string {
  if (!Number.isInteger(valor) || valor < 0) throw new Error('VALOR_INVALIDO');
  if (valor === 0) return 'zero';
  if (valor > 999_999_999) throw new Error('VALOR_FORA_DE_FAIXA');

  if (valor < 1000) return ateNovecentos(valor);

  if (valor < 1_000_000) {
    const milhares = Math.floor(valor / 1000);
    // O modelo do escritório escreve "um mil", não "mil" — mantido.
    const prefixo = `${ateNovecentos(milhares)} mil`;
    return ligarMilhar(prefixo, valor % 1000);
  }

  const milhoes = Math.floor(valor / 1_000_000);
  const resto = valor % 1_000_000;
  const prefixo = `${ateNovecentos(milhoes)} ${milhoes === 1 ? 'milhão' : 'milhões'}`;
  if (!resto) return prefixo;
  const conector = resto < 100 || resto % 100 === 0 ? ' e ' : ', ';
  return `${prefixo}${conector}${numeroPorExtenso(resto)}`;
}

/** "dois mil e oitocentos reais" / "... e trinta e um centavos". */
export function valorPorExtenso(centavos: number): string {
  if (!Number.isInteger(centavos) || centavos < 0) throw new Error('VALOR_INVALIDO');
  const reais = Math.floor(centavos / 100);
  const resto = centavos % 100;

  const parteReais =
    reais === 0 ? '' : `${numeroPorExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`;
  const parteCentavos =
    resto === 0 ? '' : `${numeroPorExtenso(resto)} ${resto === 1 ? 'centavo' : 'centavos'}`;

  if (parteReais && parteCentavos) return `${parteReais} e ${parteCentavos}`;
  return parteReais || parteCentavos || 'zero reais';
}

export function moedaBRL(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const inteiro = Math.floor(absoluto / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sinal}R$ ${inteiro},${String(absoluto % 100).padStart(2, '0')}`;
}

/** "31 de dezembro de 2026", sem passar por fuso local. */
export function dataPorExtenso(iso: string): string {
  const [ano, mes, dia] = iso.split('-').map(Number);
  if (!ano || !mes || !dia || mes < 1 || mes > 12) throw new Error('DATA_INVALIDA');
  return `${String(dia).padStart(2, '0')} de ${MESES[mes - 1]} de ${ano}`;
}

/**
 * Substitui {{chave}} pelos valores informados.
 *
 * Um marcador sem valor é erro, não string vazia: um contrato que sai com
 * "residente e domiciliada na , /, CEP" é pior que um contrato que não sai.
 */
export function preencherModelo(modelo: string, valores: Record<string, string>): string {
  const faltando: string[] = [];
  const texto = modelo.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, chave: string) => {
    const valor = valores[chave];
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      faltando.push(chave);
      return `{{${chave}}}`;
    }
    return String(valor);
  });

  if (faltando.length) {
    const erro = new Error('CONTRACT_VARIABLES_MISSING') as Error & { missing: string[] };
    erro.missing = [...new Set(faltando)];
    throw erro;
  }
  return texto.trim();
}

/** Marcadores que um modelo exige, para validar antes de emitir. */
export function marcadoresDoModelo(modelo: string): string[] {
  const encontrados = modelo.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi);
  return [...new Set([...encontrados].map((m) => m[1]!))];
}
