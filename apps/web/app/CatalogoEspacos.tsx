'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CatalogoEspaco } from '@/server/catalogo/catalogo';

const VISIVEIS = 5;

/**
 * Catálogo por espaço na vitrine: capa grande + algumas fotos, e um visualizador
 * em tela cheia com teclado (← → Esc). As imagens vêm do Instagram oficial e
 * só aparecem as que um administrador confirmou para aquele espaço.
 */
export default function CatalogoEspacos({ espacos, conta }: { espacos: CatalogoEspaco[]; conta: string | null }) {
  const [aberta, setAberta] = useState<{ espaco: number; foto: number } | null>(null);
  const [ativo, setAtivo] = useState(0);

  const fechar = useCallback(() => setAberta(null), []);
  const mover = useCallback(
    (passo: number) =>
      setAberta((a) => {
        if (!a) return a;
        const total = espacos[a.espaco]!.fotos.length;
        return { ...a, foto: (a.foto + passo + total) % total };
      }),
    [espacos]
  );

  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
      if (e.key === 'ArrowRight') mover(1);
      if (e.key === 'ArrowLeft') mover(-1);
    };
    document.addEventListener('keydown', tecla);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla);
      document.body.style.overflow = '';
    };
  }, [aberta, fechar, mover]);

  if (!espacos.length) return null;
  const espaco = espacos[ativo] ?? espacos[0]!;
  const foto = aberta ? espacos[aberta.espaco]!.fotos[aberta.foto] : null;

  return (
    <section className="catalogo" id="espacos" aria-labelledby="catalogo-titulo">
      <div className="catalogo-head">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h2 id="catalogo-titulo">Conheça cada espaço.</h2>
        </div>
        {conta && (
          <a className="link" href={`https://www.instagram.com/${conta}/`} rel="noreferrer" target="_blank">
            Mais fotos em @{conta}
          </a>
        )}
      </div>

      {espacos.length > 1 && (
        <div className="catalogo-tabs" role="tablist" aria-label="Espaços">
          {espacos.map((e, i) => (
            <button
              aria-selected={i === ativo}
              className={i === ativo ? 'unit-tab on' : 'unit-tab'}
              key={e.slug}
              onClick={() => setAtivo(i)}
              role="tab"
              style={i === ativo ? { borderBottomColor: e.cor ?? undefined } : undefined}
              type="button"
            >
              <i className="unit-dot" style={{ background: e.cor ?? '#587276' }} /> {e.nome}
            </button>
          ))}
        </div>
      )}

      <div className="catalogo-galeria" role="tabpanel" aria-label={espaco.nome}>
        {espaco.fotos.slice(0, VISIVEIS).map((f, i) => (
          <button
            aria-label={`Abrir foto ${i + 1} de ${espaco.fotos.length}${f.descricao ? `: ${f.descricao}` : ''}`}
            className={i === 0 ? 'catalogo-foto destaque' : 'catalogo-foto'}
            key={f.id}
            onClick={() => setAberta({ espaco: espacos.indexOf(espaco), foto: i })}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={f.descricao ?? `${espaco.nome}, foto ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} referrerPolicy="no-referrer" src={f.miniatura} />
            {f.tipo === 'VIDEO' && <span className="catalogo-play" aria-hidden>▶</span>}
            {i === VISIVEIS - 1 && espaco.fotos.length > VISIVEIS && (
              <span className="catalogo-mais">+{espaco.fotos.length - VISIVEIS} fotos</span>
            )}
          </button>
        ))}
      </div>
      {espaco.local && <p className="hint">{espaco.local}</p>}

      {aberta && foto && (
        <div aria-label={`${espacos[aberta.espaco]!.nome}, foto ${aberta.foto + 1}`} aria-modal="true" className="visualizador" role="dialog">
          <button aria-label="Fechar" className="visualizador-fechar" onClick={fechar} type="button">
            ✕
          </button>
          <button aria-label="Foto anterior" className="visualizador-seta esq" onClick={() => mover(-1)} type="button">
            ‹
          </button>
          <figure>
            {foto.tipo === 'VIDEO' ? (
              <video autoPlay controls playsInline poster={foto.miniatura} src={foto.url} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={foto.descricao ?? espacos[aberta.espaco]!.nome} referrerPolicy="no-referrer" src={foto.url} />
            )}
            <figcaption>
              {espacos[aberta.espaco]!.nome} · {aberta.foto + 1}/{espacos[aberta.espaco]!.fotos.length}
              {foto.descricao ? ` · ${foto.descricao}` : ''}
              {foto.permalink && (
                <>
                  {' · '}
                  <a href={foto.permalink} rel="noreferrer" target="_blank">
                    ver no Instagram
                  </a>
                </>
              )}
            </figcaption>
          </figure>
          <button aria-label="Próxima foto" className="visualizador-seta dir" onClick={() => mover(1)} type="button">
            ›
          </button>
          <button aria-hidden className="visualizador-fundo" onClick={fechar} tabIndex={-1} type="button" />
        </div>
      )}
    </section>
  );
}
