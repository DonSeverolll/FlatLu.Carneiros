'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

const ATRASO_POR_LETRA_MS = 45;
const DURACAO_LETRA_MS = 1100;

type Estado = 'espera' | 'escrevendo' | 'pronta';

/**
 * Texto que se escreve como uma assinatura: o contorno de cada letra é
 * desenhado à mão, uma letra depois da outra, e então a letra se preenche.
 * Inspirado no Signature do Spell UI, mas usando a fonte do próprio site.
 *
 * O texto de verdade continua no HTML o tempo todo (o Google e os leitores de
 * tela leem o título normal); por cima dele, enquanto escreve, vai um desenho
 * em SVG com as mesmas letras, que some no fim. Começa quando o texto aparece
 * na tela — na página inicial, depois da abertura com a casa.
 */
export default function Assinatura({ texto }: { texto: string }) {
  const raiz = useRef<HTMLSpanElement>(null);
  const [estado, setEstado] = useState<Estado | undefined>(undefined);
  const [medidas, setMedidas] = useState<{ base: number[]; cor: string; traco: number } | null>(null);
  const palavras = texto.split(' ');

  useEffect(() => {
    const el = raiz.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setEstado('espera');
    const html = document.documentElement;
    let visivel = false;
    let comecou = false;
    let relogio: number | undefined;

    const comecar = () => {
      const liberado = !html.classList.contains('abertura') || html.classList.contains('abertura-saindo');
      if (comecou || !visivel || !liberado) return;
      comecou = true;
      const estilo = getComputedStyle(el);
      const tamanho = parseFloat(estilo.fontSize) || 16;
      // Linha de base de cada palavra, para o desenho cair em cima das letras.
      const base = Array.from(el.querySelectorAll<HTMLElement>('.assinatura-base')).map((m) => m.offsetTop);
      // A cor vem do pai: o próprio texto já está transparente na espera.
      const cor = getComputedStyle(el.parentElement ?? el).color;
      setMedidas({ base, cor, traco: tamanho * 5 });
      setEstado('escrevendo');
      const letras = texto.replace(/ /g, '').length;
      relogio = window.setTimeout(() => setEstado('pronta'), (letras - 1) * ATRASO_POR_LETRA_MS + DURACAO_LETRA_MS + 100);
    };

    const observador = new IntersectionObserver(
      ([e]) => {
        visivel = !!e?.isIntersecting;
        comecar();
      },
      { threshold: 0.4 }
    );
    observador.observe(el);
    const classes = new MutationObserver(comecar);
    classes.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observador.disconnect();
      classes.disconnect();
      window.clearTimeout(relogio);
    };
  }, [texto]);

  let indice = 0;
  return (
    <span className="assinatura" data-estado={estado} ref={raiz}>
      {palavras.map((palavra, p) => (
        <Fragment key={p}>
          {p > 0 && ' '}
          <span className="assinatura-palavra">
            {palavra}
            <span aria-hidden="true" className="assinatura-base" />
            {estado === 'escrevendo' && medidas && (
              <svg aria-hidden="true" className="assinatura-desenho" xmlns="http://www.w3.org/2000/svg">
                <text
                  style={{ ['--cor' as string]: medidas.cor, ['--traco' as string]: `${medidas.traco}px` }}
                  x="0"
                  y={medidas.base[p] ?? 0}
                >
                  {Array.from(palavra).map((letra, i) => (
                    <tspan key={i} style={{ animationDelay: `${indice++ * ATRASO_POR_LETRA_MS}ms` }}>
                      {letra}
                    </tspan>
                  ))}
                </text>
              </svg>
            )}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
