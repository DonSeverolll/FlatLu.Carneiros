'use client';

import { useEffect, useRef, useState } from 'react';
import type { LogoMarca } from '@/lib/logosMarcas';

const POR_VEZ = 4;
const INTERVALO_MS = 2800;

function Logo({ logo }: { logo: LogoMarca }) {
  return (
    <>
      <svg aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d={logo.d} fill="currentColor" />
      </svg>
      <span>{logo.nome}</span>
    </>
  );
}

type Props = { id: string; eyebrow: string; titulo: string; logos: LogoMarca[] };

/**
 * Carrossel de logotipos do rodapé (canais e pagamento):
 * quatro posições, e de tempos em tempos cada uma troca de logotipo (o que sai
 * sobe e desfoca, o novo entra por baixo), uma depois da outra. Inspirado no
 * LogosCarousel do Spell UI, feito com CSS. Para leitores de tela, a lista
 * inteira, sem animação.
 */

export default function CarrosselMarcas({ id, eyebrow, titulo, logos }: Props) {
  const GRUPOS = Math.ceil(logos.length / POR_VEZ);
  const [rodada, setRodada] = useState(0);
  const raiz = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let relogio: number | undefined;
    const parar = () => window.clearInterval(relogio);
    const seguir = () => {
      parar();
      relogio = window.setInterval(() => setRodada((r) => r + 1), INTERVALO_MS);
    };
    // Só gira com o carrossel na tela e a aba aberta.
    const observador = new IntersectionObserver(([e]) => (e?.isIntersecting && !document.hidden ? seguir() : parar()));
    if (raiz.current) observador.observe(raiz.current);
    const aba = () => (document.hidden ? parar() : raiz.current && seguir());
    document.addEventListener('visibilitychange', aba);
    return () => {
      parar();
      observador.disconnect();
      document.removeEventListener('visibilitychange', aba);
    };
  }, []);

  const grupo = rodada % GRUPOS;
  const anterior = rodada === 0 ? null : (rodada - 1) % GRUPOS;

  return (
    <section aria-labelledby={`${id}-titulo`} className="marcas" ref={raiz}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={`${id}-titulo`}>{titulo}</h2>
      <ul className="sr-only">
        {logos.map((l) => (
          <li key={l.nome}>{l.nome}</li>
        ))}
      </ul>
      <div aria-hidden="true" className="marcas-faixa">
        {Array.from({ length: POR_VEZ }, (_, i) => {
          const atual = logos[(grupo * POR_VEZ + i) % logos.length]!;
          const saindo = anterior === null ? null : logos[(anterior * POR_VEZ + i) % logos.length]!;
          const atraso = { animationDelay: `${i * 140}ms` };
          return (
            <div className="marcas-posicao" key={i}>
              {saindo && saindo !== atual && (
                <div className="marcas-logo saindo" key={`s${rodada}`} style={atraso}>
                  <Logo logo={saindo} />
                </div>
              )}
              <div className={anterior === null ? 'marcas-logo' : 'marcas-logo entrando'} key={`e${rodada}`} style={atraso}>
                <Logo logo={atual} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint marcas-nota">Verificado</p>
    </section>
  );
}
