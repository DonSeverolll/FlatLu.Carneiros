'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/api';
import { AUDIT_LABEL, AUDIT_TONE, ENTITY_LABEL, dateTime } from '@/lib/format';

type Evento = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_user_id: string | null;
  actor_name: string;
  actor_username: string | null;
  actor_role: string | null;
  target_label: string | null;
};

type Resposta = {
  events: Evento[];
  total: number;
  limit: number;
  offset: number;
  eventTypes: { value: string; total: number }[];
  actors: { id: string; full_name: string; username: string | null }[];
};

/** Campos do metadata que já viram coluna ou rótulo — repeti-los seria ruído. */
const REDUNDANTES = new Set(['blockId', 'source', 'unit', 'role']);

const ROTULO_META: Record<string, string> = {
  reason: 'motivo',
  identifier: 'tentou entrar como',
  ip: 'IP',
  userAgent: 'navegador',
  email: 'e-mail',
  amount: 'valor',
  provider: 'provedor',
  transactionId: 'transação',
  reference: 'referência',
  firstNight: 'primeira noite',
  lastNight: 'última noite',
  note: 'nota',
  refund: 'reembolso'
};

/** O user-agent inteiro afogaria a linha; o começo já identifica o navegador. */
function encurtar(valor: string): string {
  return valor.length > 70 ? `${valor.slice(0, 70)}…` : valor;
}

function detalhe(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';
  const partes: string[] = [];
  for (const [chave, valor] of Object.entries(metadata)) {
    if (valor === null || valor === undefined || valor === '' || REDUNDANTES.has(chave)) continue;
    if (typeof valor === 'object') continue;
    partes.push(`${ROTULO_META[chave] ?? chave}: ${encurtar(String(valor))}`);
  }
  return partes.join(' · ');
}

/**
 * Log de tudo que o sistema registrou.
 *
 * Cada linha responde quatro coisas na mesma altura: quando, quem, o quê e
 * sobre qual registro. Os filtros de tipo e de autor são montados a partir do
 * que existe no banco, então um evento novo aparece sozinho na lista.
 */
export default function LogView() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [autor, setAutor] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [pagina, setPagina] = useState(0);
  const [mensagem, setMensagem] = useState('Carregando o log...');

  const limite = 60;

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(limite), offset: String(pagina * limite) });
    if (busca.trim()) params.set('search', busca.trim());
    if (tipo) params.set('eventType', tipo);
    if (autor) params.set('actor', autor);
    if (de) params.set('from', de);
    if (ate) params.set('to', ate);
    try {
      setDados(await api<Resposta>(`/api/admin/audit?${params}`));
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, [busca, tipo, autor, de, ate, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Trocar um filtro precisa voltar para a primeira página; senão a tela pode
  // abrir vazia por estar em um offset que o novo filtro não alcança.
  function filtrar(acao: () => void) {
    acao();
    setPagina(0);
  }

  function limpar() {
    setBusca('');
    setTipo('');
    setAutor('');
    setDe('');
    setAte('');
    setPagina(0);
  }

  const temFiltro = Boolean(busca || tipo || autor || de || ate);
  const paginas = dados ? Math.ceil(dados.total / limite) : 0;

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Log</p>
          <h1>Tudo que aconteceu.</h1>
        </div>
        <div className="filter-row">
          <button className="button button-small" type="button" onClick={() => void carregar()}>
            Atualizar
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="rate-grid">
          <label>
            Buscar
            <input
              value={busca}
              onChange={(e) => filtrar(() => setBusca(e.target.value))}
              placeholder="motivo, nome, e-mail..."
            />
          </label>
          <label>
            Evento
            <select value={tipo} onChange={(e) => filtrar(() => setTipo(e.target.value))}>
              <option value="">Todos os eventos</option>
              {dados?.eventTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {AUDIT_LABEL[t.value] ?? t.value} ({t.total})
                </option>
              ))}
            </select>
          </label>
          <label>
            Quem fez
            <select value={autor} onChange={(e) => filtrar(() => setAutor(e.target.value))}>
              <option value="">Qualquer pessoa</option>
              {dados?.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                  {a.username ? ` (${a.username})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input type="date" value={de} onChange={(e) => filtrar(() => setDe(e.target.value))} />
          </label>
          <label>
            Até
            <input type="date" value={ate} onChange={(e) => filtrar(() => setAte(e.target.value))} />
          </label>
        </div>
        {temFiltro && (
          <button className="text-button" type="button" onClick={limpar}>
            Limpar filtros
          </button>
        )}
      </section>

      <section className="panel">
        <div className="admin-heading">
          <h2>
            {dados ? `${dados.total} evento(s)` : 'Carregando...'}
            {temFiltro && dados ? ' com os filtros aplicados' : ''}
          </h2>
          {paginas > 1 && (
            <span className="hint">
              Página {pagina + 1} de {paginas}
            </span>
          )}
        </div>

        {dados?.events.length ? (
          <ol className="log-list">
            {dados.events.map((evento) => {
              const tom = AUDIT_TONE[evento.event_type];
              const extra = detalhe(evento.metadata);
              return (
                <li className="log-item" key={evento.id}>
                  <time className="log-when" dateTime={evento.created_at}>
                    {dateTime(evento.created_at)}
                  </time>
                  <div className="log-body">
                    <p className="log-what">
                      <em className={tom ? `tag ${tom}` : 'tag'}>
                        {AUDIT_LABEL[evento.event_type] ?? evento.event_type}
                      </em>
                      <strong>{evento.actor_name}</strong>
                      {evento.actor_role === 'ADMIN' && <small className="log-role">admin</small>}
                    </p>
                    <p className="log-target">
                      {ENTITY_LABEL[evento.entity_type] ?? evento.entity_type}
                      {evento.target_label ? ` · ${evento.target_label}` : ''}
                    </p>
                    {extra && <p className="log-meta">{extra}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          !mensagem && (
            <p className="hint">
              {temFiltro
                ? 'Nenhum evento com esses filtros.'
                : 'Nenhum evento registrado ainda.'}
            </p>
          )
        )}

        {paginas > 1 && (
          <div className="row-actions">
            <button
              className="button button-small"
              type="button"
              disabled={pagina === 0}
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
            >
              Anteriores
            </button>
            <button
              className="button button-small"
              type="button"
              disabled={pagina + 1 >= paginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próximos
            </button>
          </div>
        )}
      </section>

      {mensagem && (
        <p className="feedback" role="status">
          {mensagem}
        </p>
      )}
    </>
  );
}
