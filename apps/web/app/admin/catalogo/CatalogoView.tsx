'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, messageFor } from '@/lib/api';

type Midia = {
  id: string;
  tipo: 'IMAGE' | 'VIDEO';
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  legenda: string | null;
  publicado_em: string | null;
  property_id: string | null;
  sugestao_property_id: string | null;
  sugestao_origem: 'LEGENDA' | 'IA' | null;
  sugestao_motivo: string | null;
  sugestao_nome: string | null;
  visivel: boolean;
  capa: boolean;
  ordem: number;
  descricao: string | null;
};
type Espaco = { id: string; slug: string; nome: string; color: string | null; palavras: string[] };
type Dados = {
  midias: Midia[];
  espacos: Espaco[];
  ultimaSincronizacao: { iniciado_em: string; ok: boolean | null; detalhe: Record<string, unknown> } | null;
  instagramConectado: boolean;
  iaDisponivel: boolean;
  modeloIa: string;
};

const miniatura = (m: Midia) => (m.tipo === 'VIDEO' ? m.thumbnail_url ?? m.media_url : m.media_url ?? m.thumbnail_url);

function CartaoFoto({
  m,
  espacos,
  ocupado,
  alterar
}: {
  m: Midia;
  espacos: Espaco[];
  ocupado: boolean;
  alterar: (id: string, corpo: Record<string, unknown>) => Promise<void>;
}) {
  const [descricao, setDescricao] = useState(m.descricao ?? '');
  useEffect(() => setDescricao(m.descricao ?? ''), [m.descricao]);
  const src = miniatura(m);

  return (
    <article className={['foto-card', m.capa ? 'capa' : '', !m.visivel ? 'oculta' : ''].filter(Boolean).join(' ')}>
      <div className="foto-thumb">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={m.descricao ?? m.legenda?.slice(0, 80) ?? 'Foto do Instagram'} loading="lazy" src={src} />
        ) : (
          <span className="hint">sem imagem</span>
        )}
        {m.tipo === 'VIDEO' && <em className="foto-tipo">▶ vídeo</em>}
        {m.capa && <em className="foto-capa">★ capa</em>}
      </div>
      <div className="foto-info">
        {m.legenda && <p className="foto-legenda">{m.legenda}</p>}
        <small className="hint">
          {m.publicado_em ? new Date(m.publicado_em).toLocaleDateString('pt-BR') : ''}
          {m.permalink && (
            <>
              {' · '}
              <a className="link" href={m.permalink} rel="noreferrer" target="_blank">
                ver no Instagram
              </a>
            </>
          )}
        </small>

        {!m.property_id && m.sugestao_motivo && (
          <div className={`foto-sugestao ${m.sugestao_property_id ? '' : 'vazia'}`}>
            <span>
              {m.sugestao_property_id ? (
                <>
                  Sugestão: <strong>{m.sugestao_nome}</strong> — {m.sugestao_motivo}
                </>
              ) : (
                m.sugestao_motivo
              )}
            </span>
            {m.sugestao_property_id && (
              <button
                className="text-button"
                disabled={ocupado}
                onClick={() => void alterar(m.id, { propertyId: m.sugestao_property_id })}
                type="button"
              >
                Aceitar
              </button>
            )}
          </div>
        )}

        <label className="foto-campo">
          Espaço
          <select
            disabled={ocupado}
            onChange={(e) => void alterar(m.id, { propertyId: e.target.value || null })}
            value={m.property_id ?? ''}
          >
            <option value="">— sem espaço (não aparece no site) —</option>
            {espacos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </label>

        {m.property_id && (
          <>
            <label className="foto-campo">
              Texto alternativo
              <input
                maxLength={300}
                onBlur={() => {
                  if (descricao !== (m.descricao ?? '')) void alterar(m.id, { descricao: descricao || null });
                }}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex.: piscina do térreo com espreguiçadeiras"
                value={descricao}
              />
            </label>
            <div className="foto-acoes">
              <button
                className={m.capa ? 'chip on' : 'chip'}
                disabled={ocupado}
                onClick={() => void alterar(m.id, { capa: !m.capa })}
                title="A capa abre a galeria do espaço no site"
                type="button"
              >
                ★ Capa
              </button>
              <button
                className={m.visivel ? 'chip' : 'chip on'}
                disabled={ocupado}
                onClick={() => void alterar(m.id, { visivel: !m.visivel })}
                type="button"
              >
                {m.visivel ? 'Ocultar' : 'Mostrar'}
              </button>
              <button
                aria-label="Mover para antes"
                className="chip"
                disabled={ocupado}
                onClick={() => void alterar(m.id, { ordem: m.ordem - 1 })}
                type="button"
              >
                ←
              </button>
              <button
                aria-label="Mover para depois"
                className="chip"
                disabled={ocupado}
                onClick={() => void alterar(m.id, { ordem: m.ordem + 1 })}
                type="button"
              >
                →
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function Palavras({ espaco, salvar }: { espaco: Espaco; salvar: (id: string, palavras: string[]) => Promise<void> }) {
  const [texto, setTexto] = useState(espaco.palavras.join(', '));
  useEffect(() => setTexto(espaco.palavras.join(', ')), [espaco.palavras]);
  const lista = texto.split(',').map((p) => p.trim()).filter((p) => p.length >= 2);
  const mudou = lista.join('|') !== espaco.palavras.join('|');
  return (
    <div className="palavras">
      <label>
        Palavras na legenda que indicam este espaço
        <input onChange={(e) => setTexto(e.target.value)} placeholder="carneiros, flat, tamandaré" value={texto} />
      </label>
      <button className="chip" disabled={!mudou} onClick={() => void salvar(espaco.id, lista)} type="button">
        Salvar palavras
      </button>
    </div>
  );
}

/**
 * Catálogo de fotos por espaço, vindo do Instagram oficial. Nada aparece no
 * site sem um espaço confirmado aqui.
 */
export default function CatalogoView() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [mensagem, setMensagem] = useState('Carregando…');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDados(await api<Dados>('/api/admin/catalogo'));
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function acao(fn: () => Promise<string>) {
    setOcupado(true);
    try {
      setMensagem(await fn());
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(false);
    }
  }

  const alterar = (id: string, corpo: Record<string, unknown>) =>
    acao(async () => {
      await api(`/api/admin/catalogo/${id}`, { method: 'PATCH', body: corpo });
      return '';
    });

  const sincronizar = () =>
    acao(async () => {
      setMensagem('Buscando posts no Instagram…');
      const r = await api<{ conta: string; fotos: number; novas: number; sugeridas: number }>('/api/admin/catalogo/sincronizar', {
        method: 'POST'
      });
      return `@${r.conta}: ${r.fotos} foto(s) lidas, ${r.novas} nova(s), ${r.sugeridas} com espaço sugerido pela legenda.`;
    });

  const sugerirIA = () =>
    acao(async () => {
      setMensagem('O Claude está analisando as fotos…');
      const r = await api<{ analisadas: number; identificadas: number; restantes: number }>('/api/admin/catalogo/classificar', {
        method: 'POST'
      });
      return `${r.analisadas} foto(s) analisadas, ${r.identificadas} com espaço identificado.${r.restantes ? ` Faltam ${r.restantes}: clique de novo para continuar.` : ''}`;
    });

  const aceitarTodas = () =>
    acao(async () => {
      const r = await api<{ aceitas: number }>('/api/admin/catalogo/aceitar', { method: 'POST' });
      return `${r.aceitas} sugestão(ões) aceitas. Confira cada espaço abaixo.`;
    });

  const salvarPalavras = (id: string, palavras: string[]) =>
    acao(async () => {
      await api('/api/admin/catalogo/palavras', { method: 'PUT', body: { propertyId: id, palavras } });
      return 'Palavras salvas. Elas valem para as próximas sincronizações.';
    });

  const revisar = dados?.midias.filter((m) => !m.property_id) ?? [];
  const comSugestao = revisar.filter((m) => m.sugestao_property_id).length;
  const semAnaliseIA = revisar.filter((m) => m.sugestao_origem !== 'IA').length;

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Fotos de cada espaço.</h1>
        </div>
        <div className="filter-row">
          <button className="chip" disabled={ocupado || !dados?.instagramConectado} onClick={() => void sincronizar()} type="button">
            Sincronizar Instagram
          </button>
          <button
            className="chip"
            disabled={ocupado || !dados?.iaDisponivel || !semAnaliseIA}
            onClick={() => void sugerirIA()}
            title={dados?.iaDisponivel ? `Usa ${dados.modeloIa}; consome créditos` : 'Configure a chave em Configurações › Agente de IA'}
            type="button"
          >
            ✨ Sugerir espaço com IA {semAnaliseIA ? `(${semAnaliseIA})` : ''}
          </button>
          <button className="chip" disabled={ocupado || !comSugestao} onClick={() => void aceitarTodas()} type="button">
            Aceitar sugestões {comSugestao ? `(${comSugestao})` : ''}
          </button>
        </div>
      </header>

      {dados && !dados.instagramConectado && (
        <section className="panel">
          <h2 className="sub">Conecte o Instagram oficial</h2>
          <p className="hint">
            As fotos vêm direto da conta, pela API oficial da Meta. Preencha o ID da Página, o ID da conta do
            Instagram e o token (com a permissão <code>instagram_basic</code>) em{' '}
            <Link className="link" href="/admin/configuracoes#integracoes">
              Configurações › Integrações
            </Link>
            .
          </p>
        </section>
      )}

      {dados?.ultimaSincronizacao && (
        <p className="hint">
          Última sincronização: {new Date(dados.ultimaSincronizacao.iniciado_em).toLocaleString('pt-BR')}
          {dados.ultimaSincronizacao.ok === false ? ' — falhou' : ''}. As URLs das fotos são renovadas todo dia pelo
          cron.
        </p>
      )}

      {dados && (
        <>
          <section className="panel catalogo-secao">
            <h2 className="sub">
              Para revisar <small className="hint">{revisar.length} foto(s) sem espaço — não aparecem no site</small>
            </h2>
            {revisar.length ? (
              <div className="foto-grid">
                {revisar.map((m) => (
                  <CartaoFoto alterar={alterar} espacos={dados.espacos} key={m.id} m={m} ocupado={ocupado} />
                ))}
              </div>
            ) : (
              <p className="hint">Nada pendente.</p>
            )}
          </section>

          {dados.espacos.map((e) => {
            const fotos = dados.midias.filter((m) => m.property_id === e.id);
            return (
              <section className="panel catalogo-secao" key={e.id} style={{ borderTop: `3px solid ${e.color ?? '#587276'}` }}>
                <h2 className="sub">
                  {e.nome} <small className="hint">{fotos.filter((f) => f.visivel).length} visível(is) no site</small>
                </h2>
                <Palavras espaco={e} salvar={salvarPalavras} />
                {fotos.length ? (
                  <div className="foto-grid">
                    {fotos.map((m) => (
                      <CartaoFoto alterar={alterar} espacos={dados.espacos} key={m.id} m={m} ocupado={ocupado} />
                    ))}
                  </div>
                ) : (
                  <p className="hint">Nenhuma foto confirmada. Este espaço não aparece no catálogo do site.</p>
                )}
              </section>
            );
          })}
        </>
      )}

      {mensagem && (
        <p className="feedback" role="status">
          {mensagem}
        </p>
      )}
    </>
  );
}
