/**
 * Gerador de PDF mínimo, só texto, sem dependência.
 *
 * Existe para o guia da região poder ser baixado como arquivo — e aparecer nas
 * buscas `filetype:pdf` do Google. Usa as fontes padrão do PDF (Helvetica), que
 * todo leitor tem, com WinAnsiEncoding para os acentos do português.
 */

export type BlocoPdf = {
  tipo: 'titulo' | 'subtitulo' | 'texto' | 'pequeno';
  texto: string;
};

const A4 = { largura: 595, altura: 842 };
const MARGEM = 56;
const ESTILO = {
  titulo: { fonte: 'F2', tamanho: 20, antes: 0 },
  subtitulo: { fonte: 'F2', tamanho: 14, antes: 14 },
  texto: { fonte: 'F1', tamanho: 11, antes: 6 },
  pequeno: { fonte: 'F1', tamanho: 9, antes: 6 }
} as const;

/** Caracteres fora do Latin-1 que o WinAnsi tem em 0x80–0x9F. */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99
};

/** Texto → bytes WinAnsi; o que não existe na tabela vira "?". */
export function paraWinAnsi(texto: string): number[] {
  const bytes: number[] = [];
  for (const ch of texto.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (WIN_ANSI[ch] !== undefined) bytes.push(WIN_ANSI[ch]);
    else if (code >= 0x20 && code <= 0x7e) bytes.push(code);
    else if (code >= 0xa0 && code <= 0xff) bytes.push(code);
    else bytes.push(0x3f);
  }
  return bytes;
}

/** String literal do PDF, só ASCII: parênteses e barra escapados, resto em octal. */
function literal(texto: string): string {
  let out = '(';
  for (const b of paraWinAnsi(texto)) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b < 0x80) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, '0')}`;
  }
  return `${out})`;
}

/** Texto dos metadados (título, autor) em UTF-16BE, que aceita qualquer acento. */
function textoUnicode(texto: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < texto.length; i++) hex += texto.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

/** Largura aproximada na Helvetica, em unidades de 1/1000 do tamanho da fonte. */
function larguraDoChar(ch: string, negrito: boolean): number {
  let w: number;
  if (' .,;:\'!|ijlIft'.includes(ch)) w = 280;
  else if ('rJ-()'.includes(ch)) w = 333;
  else if ('mwMW'.includes(ch)) w = 830;
  else if (/[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ]/.test(ch)) w = 680;
  else w = 556;
  return negrito ? w * 1.06 : w;
}

export function quebrarLinhas(texto: string, tamanho: number, negrito: boolean, largura: number): string[] {
  const linhas: string[] = [];
  let atual = '';
  const medir = (s: string) => [...s].reduce((t, ch) => t + larguraDoChar(ch, negrito), 0) * (tamanho / 1000);
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (atual && medir(tentativa) > largura) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = tentativa;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

export function gerarPdf(
  blocos: BlocoPdf[],
  meta: { titulo: string; autor: string; rodape?: string; criadoEm?: Date }
): Uint8Array {
  const larguraUtil = A4.largura - MARGEM * 2;
  const paginas: string[][] = [[]];
  let y = A4.altura - MARGEM;

  for (const bloco of blocos) {
    const estilo = ESTILO[bloco.tipo];
    const entrelinha = estilo.tamanho * 1.45;
    const linhas = quebrarLinhas(bloco.texto, estilo.tamanho, estilo.fonte === 'F2', larguraUtil);
    y -= estilo.antes;
    for (const linha of linhas) {
      if (y - entrelinha < MARGEM + 20) {
        paginas.push([]);
        y = A4.altura - MARGEM;
      }
      y -= entrelinha;
      paginas.at(-1)!.push(
        `BT /${estilo.fonte} ${estilo.tamanho} Tf ${MARGEM} ${y.toFixed(1)} Td ${literal(linha)} Tj ET`
      );
    }
  }

  // Objetos: 1 catálogo, 2 páginas, 3–4 fontes, 5 info, depois página + conteúdo.
  const objetos: string[] = [];
  const idsPaginas = paginas.map((_, i) => 6 + i * 2);
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[2] = `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objetos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  const data = (meta.criadoEm ?? new Date()).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  objetos[5] = `<< /Title ${textoUnicode(meta.titulo)} /Author ${textoUnicode(meta.autor)} /Producer (FlatLu) /CreationDate (D:${data}Z) >>`;

  paginas.forEach((comandos, i) => {
    const rodape = [meta.rodape, `Página ${i + 1} de ${paginas.length}`].filter(Boolean).join(' · ');
    const conteudo = [
      ...comandos,
      `0.4 g BT /F1 8 Tf ${MARGEM} ${MARGEM - 20} Td ${literal(rodape)} Tj ET`
    ].join('\n');
    const idPagina = idsPaginas[i]!;
    objetos[idPagina] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idPagina + 1} 0 R >>`;
    objetos[idPagina + 1] = `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`;
  });

  // Tudo acima é ASCII puro, então comprimento da string = bytes.
  let saida = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  for (let id = 1; id < objetos.length; id++) {
    offsets[id] = saida.length;
    saida += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
  }
  const inicioXref = saida.length;
  saida += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objetos.length; id++) saida += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  saida += `trailer\n<< /Size ${objetos.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;

  return Uint8Array.from(saida, (ch) => ch.charCodeAt(0));
}
