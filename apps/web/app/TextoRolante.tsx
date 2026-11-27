/**
 * Texto de botão que "rola" ao passar o mouse: cada letra sobe e some, e uma
 * cópia entra por baixo, letra a letra, a partir do meio da palavra.
 *
 * Adaptado do TextRoll do Skiper 58 (Skiper UI — https://skiperui.com, por
 * @gurvinder-singh02). O original usa framer-motion; aqui é só CSS (ver
 * `.rolante` em globals.css), sem JavaScript no navegador e sem dependência
 * nova. A animação dispara no hover/foco do link ou botão que contém o texto.
 *
 * Leitores de tela leem o texto inteiro uma vez; as letras soltas ficam
 * escondidas deles.
 */
const ATRASO_POR_LETRA_MS = 35;

export default function TextoRolante({ children }: { children: string }) {
  const letras = Array.from(children);
  const meio = (letras.length - 1) / 2;
  const linha = (classe: string) => (
    <span aria-hidden="true" className={classe}>
      {letras.map((letra, i) => (
        <span
          key={i}
          style={{ transitionDelay: `${Math.round(Math.abs(i - meio) * ATRASO_POR_LETRA_MS)}ms` }}
        >
          {letra === ' ' ? ' ' : letra}
        </span>
      ))}
    </span>
  );

  return (
    <span className="rolante">
      <span className="sr-only">{children}</span>
      {linha('rolante-linha')}
      {linha('rolante-linha rolante-copia')}
    </span>
  );
}
