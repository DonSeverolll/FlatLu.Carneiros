'use client';

import { useEffect } from 'react';

/** Marca na sessão: a casa é construída só na primeira visita da sessão. */
const CHAVE = 'apt-abertura';
/** Tempo da animação da casa (ver `.casa-*` em globals.css). */
const MINIMO_MS = 2600;
/** Se a foto demorar, o site abre assim mesmo. */
const MAXIMO_MS = 6000;
/** Remoção adiada das classes: o React em desenvolvimento desmonta e remonta na hora. */
let limpezaPendente: number | undefined;

/**
 * Roda antes da página aparecer (no HTML, antes da tela de abertura): liga a
 * abertura só na primeira visita da sessão e se o aparelho não pede menos
 * movimento. Sem JavaScript, a abertura nem aparece e o site abre direto.
 * Também marca `assinar`: os textos que se escrevem sozinhos (Assinatura.tsx)
 * ficam escondidos até começar a escrita, sem piscar; se o React não
 * assumir em 8 s, eles voltam a aparecer normais.
 */
export const SCRIPT_ABERTURA = `(function(){try{var h=document.documentElement;if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;h.classList.add('assinar');setTimeout(function(){h.classList.remove('assinar')},8000);if(sessionStorage.getItem('${CHAVE}'))return;h.classList.add('abertura')}catch(e){}})()`;

/**
 * Tela de abertura da página inicial: uma casa sendo construída na janela
 * inteira enquanto a foto principal carrega. Depois, a tela some e a foto e
 * cada parte da página aparecem com uma revelação em gradiente, de cima para
 * baixo — as de mais abaixo, quando chegam na tela.
 */
export default function Abertura({ imagem }: { imagem: string }) {
  useEffect(() => {
    const html = document.documentElement;
    window.clearTimeout(limpezaPendente);
    const comAbertura = html.classList.contains('abertura');
    const menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let observador: IntersectionObserver | null = null;
    const relogios: number[] = [];

    // Revelação em gradiente das partes da página. Sem a abertura, o que já
    // está na tela fica como está (esconder e mostrar de novo seria um piscar).
    const partes = menosMovimento
      ? []
      : Array.from(document.querySelectorAll<HTMLElement>('main > *:not(script)')).filter(
          (el) => comAbertura || el.getBoundingClientRect().top > window.innerHeight
        );
    partes.forEach((el) => el.classList.add('revelar'));
    const fim = (e: AnimationEvent) => {
      const el = e.currentTarget as HTMLElement;
      if (e.target !== el) return;
      el.classList.remove('revelar', 'revelado');
      el.removeEventListener('animationend', fim);
    };
    const revelar = () => {
      observador = new IntersectionObserver(
        (entradas) => {
          for (const entrada of entradas) {
            if (!entrada.isIntersecting) continue;
            const el = entrada.target as HTMLElement;
            el.addEventListener('animationend', fim);
            el.classList.add('revelado');
            observador?.unobserve(el);
          }
        },
        { rootMargin: '0px 0px -8% 0px' }
      );
      partes.forEach((el) => observador!.observe(el));
    };

    if (!comAbertura) {
      revelar();
    } else {
      const inicio = performance.now();
      let saiu = false;
      const sair = () => {
        if (saiu) return;
        saiu = true;
        try {
          sessionStorage.setItem(CHAVE, '1');
        } catch {
          /* aba anônima sem armazenamento: só repete a abertura */
        }
        html.classList.add('abertura-saindo');
        revelar();
        relogios.push(window.setTimeout(() => html.classList.remove('abertura', 'abertura-saindo'), 700));
      };
      const quandoPronta = () => {
        const falta = MINIMO_MS - (performance.now() - inicio);
        relogios.push(window.setTimeout(sair, Math.max(0, falta)));
      };
      const foto = new Image();
      foto.onload = quandoPronta;
      foto.onerror = quandoPronta;
      foto.src = imagem;
      relogios.push(window.setTimeout(sair, MAXIMO_MS));
    }

    return () => {
      observador?.disconnect();
      relogios.forEach((r) => clearTimeout(r));
      partes.forEach((el) => {
        el.classList.remove('revelar', 'revelado');
        el.removeEventListener('animationend', fim);
      });
      // Saiu da página com a abertura na tela: destrava a rolagem da próxima.
      limpezaPendente = window.setTimeout(() => html.classList.remove('abertura', 'abertura-saindo'), 0);
    };
  }, [imagem]);

  return (
    <div aria-hidden="true" className="abertura-tela">
      <svg className="casa" fill="none" viewBox="-14 0 234 180" xmlns="http://www.w3.org/2000/svg">
        {/* Guindaste da obra: aparece primeiro e some no fim. */}
        <g className="casa-guindaste">
          <path className="casa-traco fino" d="M196 160V22H112" pathLength={1} style={{ ['--d' as string]: '.15s' }} />
          <path className="casa-traco fino" d="M196 40L176 22M132 22V44" pathLength={1} style={{ ['--d' as string]: '.45s' }} />
        </g>
        <path className="casa-traco" d="M-8 160H210" pathLength={1} style={{ ['--d' as string]: '0s' }} />
        {/* Casa de praia: coqueiro ao lado, que cresce junto com a obra. */}
        <path
          className="casa-traco coqueiro-tronco"
          d="M16 159C21 132 13 104 26 76"
          pathLength={1}
          style={{ ['--d' as string]: '.3s' }}
        />
        <g className="coqueiro-folhas">
          <path className="casa-traco coqueiro-folha" d="M26 76C16 64 3 65 -8 76" pathLength={1} style={{ ['--d' as string]: '.95s' }} />
          <path className="casa-traco coqueiro-folha" d="M26 76C19 58 6 54 -5 57" pathLength={1} style={{ ['--d' as string]: '1.05s' }} />
          <path className="casa-traco coqueiro-folha" d="M26 76C27 60 21 49 11 43" pathLength={1} style={{ ['--d' as string]: '1.15s' }} />
          <path className="casa-traco coqueiro-folha" d="M26 76C32 59 44 55 55 60" pathLength={1} style={{ ['--d' as string]: '1.25s' }} />
          <path className="casa-traco coqueiro-folha" d="M26 76C38 69 48 72 54 82" pathLength={1} style={{ ['--d' as string]: '1.35s' }} />
        </g>
        <circle className="coqueiro-coco" cx="24" cy="81" r="3.2" />
        <circle className="coqueiro-coco" cx="30.5" cy="80" r="3.2" />
        <path className="casa-traco" d="M38 160V150H162V160" pathLength={1} style={{ ['--d' as string]: '.4s' }} />
        <path className="casa-traco" d="M48 150V88H152V150" pathLength={1} style={{ ['--d' as string]: '.75s' }} />
        <path className="casa-telhado" d="M36 92L100 42L164 92" />
        <path className="casa-traco" d="M128 66V48H140V75" pathLength={1} style={{ ['--d' as string]: '1.7s' }} />
        <rect className="casa-luz" height="18" width="18" x="62" y="104" />
        <rect className="casa-luz" height="18" width="18" x="120" y="104" />
        <path className="casa-traco" d="M88 150V118H112V150" pathLength={1} style={{ ['--d' as string]: '1.85s' }} />
        <path
          className="casa-traco"
          d="M62 104H80V122H62ZM71 104V122M62 113H80M120 104H138V122H120ZM129 104V122M120 113H138"
          pathLength={1}
          style={{ ['--d' as string]: '1.95s' }}
        />
      </svg>
      <p className="abertura-marca">APT CARNEIROS · FLAT &amp; CASA</p>
      <p className="abertura-texto">Preparando sua estadia…</p>
    </div>
  );
}
