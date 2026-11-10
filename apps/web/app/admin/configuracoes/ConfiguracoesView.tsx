'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, messageFor } from '@/lib/api';

type Estado = 'ok' | 'aviso' | 'pendente';
type Onde =
  | { tipo: 'env'; variaveis: string[] }
  | { tipo: 'painel'; href: string; rotulo: string }
  | { tipo: 'integracao'; chave: string };
type Item = { id: string; titulo: string; estado: Estado; detalhe: string; onde: Onde };
type Grupo = { grupo: string; descricao: string; itens: Item[] };

type Origem = 'painel' | 'ambiente' | 'padrao' | null;
type Campo = {
  nome: string;
  rotulo: string;
  tipo: 'texto' | 'segredo' | 'select' | 'textarea' | 'numero' | 'booleano';
  env?: string;
  padrao?: string;
  opcoes?: { valor: string; rotulo: string }[];
  ajuda?: string;
  origem: Origem;
  valor?: string;
  definido?: boolean;
  final?: string | null;
};
type Integracao = {
  chave: string;
  titulo: string;
  resumo: string;
  passos: string[];
  docs?: string;
  campos: Campo[];
  salvaNoPainel: boolean;
  segredosIlegiveis: boolean;
  teste: { em: string; ok: boolean | null; detalhe: string | null } | null;
  atualizadoEm: string | null;
};
type Dados = {
  grupos: Grupo[];
  integracoes: Integracao[];
  cifraDisponivel: boolean;
  webhooks: { whatsapp: string; instagram: string };
};

const ABAS = [
  { id: 'geral', rotulo: 'Visão geral' },
  { id: 'integracoes', rotulo: 'Integrações' },
  { id: 'agente', rotulo: 'Agente de IA' }
] as const;
type Aba = (typeof ABAS)[number]['id'];

const ROTULO_ESTADO: Record<Estado, string> = { ok: 'Configurado', aviso: 'Opcional / atenção', pendente: 'Falta configurar' };
const ROTULO_ORIGEM: Record<string, string> = { painel: 'salvo no painel', ambiente: 'variável de ambiente', padrao: 'padrão' };

function gerarToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function Copiar({ texto }: { texto: string }) {
  const [feito, setFeito] = useState(false);
  return (
    <button
      className="text-button quiet"
      onClick={() => {
        void navigator.clipboard.writeText(texto).then(() => {
          setFeito(true);
          setTimeout(() => setFeito(false), 1500);
        });
      }}
      type="button"
    >
      {feito ? 'copiado' : 'copiar'}
    </button>
  );
}

function CardIntegracao({
  item,
  dados,
  aoSalvar
}: {
  item: Integracao;
  dados: Dados;
  aoSalvar: () => Promise<void>;
}) {
  const inicial = () =>
    Object.fromEntries(item.campos.filter((c) => c.tipo !== 'segredo').map((c) => [c.nome, c.valor ?? '']));
  const [valores, setValores] = useState<Record<string, string>>(inicial);
  const [segredos, setSegredos] = useState<Record<string, string | null>>({});
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');
  const [teste, setTeste] = useState<{ ok: boolean; detalhe: string; resposta?: string } | null>(null);
  const [pergunta, setPergunta] = useState('');

  // Recarregou do servidor (salvou, apagou): os campos voltam ao que vale agora.
  useEffect(() => {
    setValores(inicial());
    setSegredos({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.atualizadoEm, item.salvaNoPainel]);

  const alterado =
    Object.keys(segredos).length > 0 ||
    item.campos.some((c) => c.tipo !== 'segredo' && (valores[c.nome] ?? '') !== (c.valor ?? ''));

  async function salvar(event: FormEvent) {
    event.preventDefault();
    setOcupado(true);
    setAviso('');
    try {
      const config: Record<string, string> = {};
      for (const c of item.campos) {
        if (c.tipo === 'segredo') continue;
        const v = valores[c.nome] ?? '';
        // Só manda o que mudou: um campo herdado da env continua herdado.
        if (v !== (c.valor ?? '') || (c.origem === 'painel' && c.tipo === 'select')) config[c.nome] = v;
      }
      await api(`/api/admin/integracoes/${item.chave}`, { method: 'PUT', body: { config, segredos } });
      setAviso('Salvo.');
      setTeste(null);
      await aoSalvar();
    } catch (error) {
      setAviso(messageFor(error));
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setOcupado(true);
    setAviso(item.chave === 'AGENTE_IA' ? 'Perguntando ao agente…' : 'Testando…');
    try {
      const r = await api<{ ok: boolean; detalhe: string; resposta?: string }>(
        `/api/admin/integracoes/${item.chave}/testar`,
        { method: 'POST', body: item.chave === 'AGENTE_IA' && pergunta.trim() ? { pergunta } : {} }
      );
      setTeste(r);
      setAviso('');
      await aoSalvar();
    } catch (error) {
      setAviso(messageFor(error));
    } finally {
      setOcupado(false);
    }
  }

  async function apagar() {
    if (!window.confirm(`Apagar o que foi salvo no painel para "${item.titulo}"? Voltam a valer as variáveis de ambiente.`)) return;
    setOcupado(true);
    try {
      await api(`/api/admin/integracoes/${item.chave}`, { method: 'DELETE' });
      setAviso('Removido do painel.');
      await aoSalvar();
    } catch (error) {
      setAviso(messageFor(error));
    } finally {
      setOcupado(false);
    }
  }

  const ultimoTeste = teste ?? (item.teste ? { ok: Boolean(item.teste.ok), detalhe: item.teste.detalhe ?? '' } : null);

  return (
    <section className="panel integ-card" id={`integ-${item.chave}`}>
      <header className="integ-head">
        <div>
          <h2 className="sub">{item.titulo}</h2>
          <p className="hint">{item.resumo}</p>
        </div>
        {ultimoTeste && (
          <span className={ultimoTeste.ok ? 'tag good' : 'tag bad'}>{ultimoTeste.ok ? 'Conexão ok' : 'Falhou'}</span>
        )}
      </header>

      {item.segredosIlegiveis && (
        <p className="feedback">
          Os tokens salvos não abrem com a chave de cifra atual (INTEGRATIONS_ENCRYPTION_KEY mudou?). Digite-os de novo.
        </p>
      )}

      <details className="integ-steps">
        <summary>Como conectar</summary>
        <ol>
          {item.passos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        {item.docs && (
          <a className="link" href={item.docs} rel="noreferrer" target="_blank">
            Documentação oficial
          </a>
        )}
      </details>

      {item.chave === 'META_APP' && (
        <div className="integ-webhooks">
          <p className="hint">URLs para cadastrar na Meta (callback do webhook):</p>
          <div>
            <span className="mono">{dados.webhooks.whatsapp}</span> <Copiar texto={dados.webhooks.whatsapp} />
          </div>
          <div>
            <span className="mono">{dados.webhooks.instagram}</span> <Copiar texto={dados.webhooks.instagram} />
          </div>
        </div>
      )}

      <form className="integ-form" onSubmit={salvar}>
        {item.campos.map((c) => {
          const origem = c.origem ? <small className={`origem ${c.origem}`}>{ROTULO_ORIGEM[c.origem]}</small> : null;
          if (c.tipo === 'segredo') {
            const novo = segredos[c.nome];
            return (
              <label key={c.nome} className="integ-field">
                <span className="integ-label">
                  {c.rotulo} {c.definido && novo === undefined && origem}
                </span>
                <input
                  autoComplete="off"
                  onChange={(e) => setSegredos((s) => ({ ...s, [c.nome]: e.target.value }))}
                  placeholder={
                    novo === null
                      ? 'será apagado do painel ao salvar'
                      : c.definido
                        ? `definido (${c.final ?? '…'}) — deixe em branco para manter`
                        : c.env
                          ? `não definido (ou use ${c.env})`
                          : 'não definido'
                  }
                  spellCheck={false}
                  type="password"
                  value={typeof novo === 'string' ? novo : ''}
                />
                <span className="integ-actions">
                  {c.nome === 'verifyToken' && (
                    <button
                      className="text-button quiet"
                      onClick={() => setSegredos((s) => ({ ...s, verifyToken: gerarToken() }))}
                      type="button"
                    >
                      Gerar
                    </button>
                  )}
                  {c.nome === 'verifyToken' && typeof novo === 'string' && novo && <Copiar texto={novo} />}
                  {c.definido && c.origem === 'painel' && (
                    <button
                      className="text-button quiet"
                      onClick={() => setSegredos((s) => ({ ...s, [c.nome]: null }))}
                      type="button"
                    >
                      apagar do painel
                    </button>
                  )}
                </span>
                {c.ajuda && <small className="hint">{c.ajuda}</small>}
              </label>
            );
          }
          if (c.tipo === 'select') {
            return (
              <label key={c.nome} className="integ-field">
                <span className="integ-label">
                  {c.rotulo} {origem}
                </span>
                <select onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))} value={valores[c.nome] ?? ''}>
                  {c.opcoes?.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
                {c.ajuda && <small className="hint">{c.ajuda}</small>}
              </label>
            );
          }
          if (c.tipo === 'booleano') {
            return (
              <label key={c.nome} className="inline-check integ-check">
                <input
                  checked={valores[c.nome] === 'true'}
                  onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.checked ? 'true' : 'false' }))}
                  type="checkbox"
                />
                {c.rotulo}
              </label>
            );
          }
          if (c.tipo === 'textarea') {
            return (
              <label key={c.nome} className="integ-field wide">
                <span className="integ-label">
                  {c.rotulo} {origem}
                </span>
                <textarea
                  className="prose-input"
                  onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                  rows={9}
                  value={valores[c.nome] ?? ''}
                />
                {c.ajuda && <small className="hint">{c.ajuda}</small>}
              </label>
            );
          }
          return (
            <label key={c.nome} className="integ-field">
              <span className="integ-label">
                {c.rotulo} {origem}
              </span>
              <input
                inputMode={c.tipo === 'numero' ? 'numeric' : undefined}
                onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                placeholder={c.env ? `ou variável ${c.env}` : undefined}
                value={valores[c.nome] ?? ''}
              />
              {c.ajuda && <small className="hint">{c.ajuda}</small>}
            </label>
          );
        })}

        {!dados.cifraDisponivel && item.campos.some((c) => c.tipo === 'segredo') && (
          <p className="hint wide">
            Para salvar tokens pelo painel, defina <code>INTEGRATIONS_ENCRYPTION_KEY</code> no servidor. Enquanto isso, os
            tokens vêm das variáveis de ambiente indicadas em cada campo.
          </p>
        )}

        <div className="integ-buttons wide">
          <button className="button button-small" disabled={ocupado || !alterado} type="submit">
            Salvar
          </button>
          <button className="chip" disabled={ocupado || alterado} onClick={() => void testar()} title={alterado ? 'Salve antes de testar' : ''} type="button">
            {item.chave === 'AGENTE_IA' ? 'Testar agente (consome créditos)' : 'Testar conexão'}
          </button>
          {item.salvaNoPainel && (
            <button className="text-button quiet" disabled={ocupado} onClick={() => void apagar()} type="button">
              Apagar do painel
            </button>
          )}
        </div>
      </form>

      {item.chave === 'AGENTE_IA' && (
        <label className="integ-field wide">
          <span className="integ-label">Pergunta de teste</span>
          <input
            onChange={(e) => setPergunta(e.target.value)}
            placeholder="Olá! Tem vaga no flat no próximo fim de semana para 2 pessoas? Quanto fica?"
            value={pergunta}
          />
        </label>
      )}

      {ultimoTeste && (
        <div className={ultimoTeste.ok ? 'integ-result good' : 'integ-result bad'}>
          <p>{ultimoTeste.detalhe}</p>
          {teste?.resposta && <blockquote>{teste.resposta}</blockquote>}
          {!teste && item.teste && <small className="hint">Último teste: {new Date(item.teste.em).toLocaleString('pt-BR')}</small>}
        </div>
      )}
      {aviso && (
        <p className="feedback" role="status">
          {aviso}
        </p>
      )}
    </section>
  );
}

export default function ConfiguracoesView() {
  const [aba, setAba] = useState<Aba>('geral');
  const [dados, setDados] = useState<Dados | null>(null);
  const [mensagem, setMensagem] = useState('Carregando…');

  const carregar = useCallback(async () => {
    try {
      setDados(await api<Dados>('/api/admin/configuracoes'));
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, []);

  useEffect(() => {
    void carregar();
    // Aba pelo endereço (#agente, #integracoes): vale ao abrir e ao seguir um
    // link com a página já aberta.
    const lerHash = () => {
      const alvo = window.location.hash.replace('#', '') as Aba;
      if (ABAS.some((a) => a.id === alvo)) setAba(alvo);
    };
    lerHash();
    window.addEventListener('hashchange', lerHash);
    return () => window.removeEventListener('hashchange', lerHash);
  }, [carregar]);

  function irPara(nova: Aba, chave?: string) {
    setAba(nova);
    window.history.replaceState(null, '', `#${nova}`);
    if (chave) setTimeout(() => document.getElementById(`integ-${chave}`)?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  const contagem = (estado: Estado) => dados?.grupos.flatMap((g) => g.itens).filter((i) => i.estado === estado).length ?? 0;

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Configurações</p>
          <h1>Como o site está montado.</h1>
        </div>
        <nav className="filter-row" aria-label="Seções">
          {ABAS.map((a) => (
            <button className={aba === a.id ? 'chip on' : 'chip'} key={a.id} onClick={() => irPara(a.id)} type="button">
              {a.rotulo}
            </button>
          ))}
        </nav>
      </header>

      {dados && aba === 'geral' && (
        <>
          <section className="stat-grid compact">
            <div className="stat-tile">
              <span className="stat-label">Configurado</span>
              <strong className="stat-value">{contagem('ok')}</strong>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Falta configurar</span>
              <strong className="stat-value">{contagem('pendente')}</strong>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Opcional / atenção</span>
              <strong className="stat-value">{contagem('aviso')}</strong>
            </div>
          </section>

          {dados.grupos.map((g) => (
            <section className="panel config-group" key={g.grupo}>
              <h2 className="sub">{g.grupo}</h2>
              <p className="hint">{g.descricao}</p>
              <ul className="config-list">
                {g.itens.map((i) => (
                  <li key={i.id} className={`config-item ${i.estado}`}>
                    <span className={`config-dot ${i.estado}`} aria-label={ROTULO_ESTADO[i.estado]} title={ROTULO_ESTADO[i.estado]} />
                    <div className="config-main">
                      <strong>{i.titulo}</strong>
                      <span>{i.detalhe}</span>
                    </div>
                    <div className="config-where">
                      {i.onde.tipo === 'env' &&
                        i.onde.variaveis.map((v) => (
                          <code key={v} title="Variável de ambiente (Vercel) ou banco">
                            {v}
                          </code>
                        ))}
                      {i.onde.tipo === 'painel' && (
                        <Link className="link" href={i.onde.href}>
                          {i.onde.rotulo}
                        </Link>
                      )}
                      {i.onde.tipo === 'integracao' && (
                        <button
                          className="link"
                          onClick={() => {
                            const chave = (i.onde as { chave: string }).chave;
                            irPara(chave === 'AGENTE_IA' ? 'agente' : 'integracoes', chave);
                          }}
                          type="button"
                        >
                          Configurar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="hint">
            Variáveis de ambiente ficam em Vercel › Settings › Environment Variables (e em <code>apps/web/.env.local</code> no
            computador). Depois de mudar uma, é preciso um novo deploy.
          </p>
        </>
      )}

      {dados && aba === 'integracoes' && (
        <div className="integ-grid">
          {dados.integracoes
            .filter((i) => i.chave !== 'AGENTE_IA')
            .map((i) => (
              <CardIntegracao aoSalvar={carregar} dados={dados} item={i} key={i.chave} />
            ))}
        </div>
      )}

      {dados && aba === 'agente' && (
        <>
          {dados.integracoes
            .filter((i) => i.chave === 'AGENTE_IA')
            .map((i) => (
              <CardIntegracao aoSalvar={carregar} dados={dados} item={i} key={i.chave} />
            ))}
          <section className="panel">
            <h2 className="sub">O que o agente pode e não pode fazer</h2>
            <ul className="hint config-rules">
              <li>Consulta disponibilidade e preço no mesmo motor de tarifas da reserva — não inventa valor.</li>
              <li>Não reserva, não cancela e não mexe em pagamento: orienta o hóspede a concluir pelo site.</li>
              <li>
                Passa a conversa para a equipe em reclamação, reembolso, cancelamento ou quando não sabe — e quando o cliente
                usa uma das palavras configuradas.
              </li>
              <li>Quando um atendente responde numa conversa, o agente para de responder nela (dá para retomar na ficha).</li>
              <li>Fora da janela de 24h do WhatsApp ele não escreve: só a equipe, com modelo aprovado.</li>
              <li>Cada resposta fica marcada como &quot;Agente IA&quot; no histórico, com o consumo de tokens registrado.</li>
            </ul>
          </section>
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
