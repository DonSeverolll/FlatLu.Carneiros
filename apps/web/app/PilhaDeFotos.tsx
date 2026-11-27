'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Fotos empilhadas na rolagem: cada foto gruda no alto da tela, um pouco abaixo
 * da anterior, e as de baixo encolhem conforme as próximas chegam por cima.
 *
 * Adaptado do Skiper 16 / StickyCard_001 (Skiper UI — https://skiperui.com, por
 * @gurvinder-singh02). O original usa framer-motion e Lenis; aqui o "grudar" é
 * `position: sticky` do CSS e o encolher é calculado na rolagem, sem
 * dependência nova. Sem JavaScript ou com "reduzir movimento", as fotos só
 * empilham, sem encolher.
 */
export default function PilhaDeFotos({ children }: { children: ReactNode[] }) {
  const pilha = useRef<HTMLDivElement>(null);
  const total = children.length;

  useEffect(() => {
    const el = pilha.current;
    if (!el || total < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cartoes = Array.from(el.querySelectorAll<HTMLElement>(':scope > .pilha-item > .pilha-cartao'));

    let quadro = 0;
    const desenhar = () => {
      quadro = 0;
      const r = el.getBoundingClientRect();
      const percurso = r.height - window.innerHeight;
      // 0 quando a pilha encosta no alto da tela; 1 quando o fim dela encosta embaixo.
      const p = percurso > 0 ? Math.min(1, Math.max(0, -r.top / percurso)) : 0;
      cartoes.forEach((cartao, i) => {
        // A última foto não encolhe; as de baixo encolhem mais (até metade).
        const alvo = Math.max(0.5, 1 - (total - i - 1) * 0.1);
        const inicio = i / total;
        const t = Math.min(1, Math.max(0, (p - inicio) / (1 - inicio)));
        cartao.style.transform = `scale(${1 - (1 - alvo) * t})`;
      });
    };
    const agendar = () => {
      if (!quadro) quadro = requestAnimationFrame(desenhar);
    };

    desenhar();
    const observador = new IntersectionObserver(([entrada]) => {
      if (entrada?.isIntersecting) {
        window.addEventListener('scroll', agendar, { passive: true });
        window.addEventListener('resize', agendar);
        agendar();
      } else {
        window.removeEventListener('scroll', agendar);
        window.removeEventListener('resize', agendar);
        desenhar();
      }
    });
    observador.observe(el);
    return () => {
      observador.disconnect();
      window.removeEventListener('scroll', agendar);
      window.removeEventListener('resize', agendar);
      if (quadro) cancelAnimationFrame(quadro);
      cartoes.forEach((c) => (c.style.transform = ''));
    };
    // Trocar de espaço remonta a pilha (key no catálogo); aqui basta o total.
  }, [total]);

  return (
    <div className="pilha" ref={pilha}>
      {children.map((filho, i) => (
        <div className="pilha-item" key={i} style={{ top: `calc(var(--pilha-topo) + ${i * 20}px)` }}>
          <div className="pilha-cartao">{filho}</div>
        </div>
      ))}
    </div>
  );
}
