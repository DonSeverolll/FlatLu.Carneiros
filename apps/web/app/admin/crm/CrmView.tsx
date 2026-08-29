'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/api';
import { CRM_STAGE, brl, shortDate } from '@/lib/format';

type Lead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string;
  source: string;
  estimated_amount: string | null;
  check_in: string | null;
  check_out: string | null;
  next_action: string | null;
  next_action_at: string | null;
  lost_reason: string | null;
  unidade: string | null;
  unidade_cor: string | null;
  dono: string | null;
  atrasado: boolean;
  reservation_id: string | null;
};

type Atividade = {
  id: string;
  kind: string;
  body: string;
  created_at: string;
  autor: string | null;
};

const ORDEM = ['NEW', 'CONTACTED', 'QUOTED', 'NEGOTIATING', 'WON', 'LOST'];

/**
 * Funil em colunas. O estágio é sincronizado pela própria reserva (criada,
 * contrato assinado, sinal pago), então o quadro reflete o que aconteceu sem
 * depender de alguém lembrar de arrastar card.
 */
export default function CrmView() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [porEstagio, setPorEstagio] = useState<{ stage: string; total: string; valor: string }[]>([]);
  const [soAtrasados, setSoAtrasados] = useState(false);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [mensagem, setMensagem] = useState('Carregando funil...');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (soAtrasados) params.set('overdueOnly', 'true');
      if (busca.trim()) params.set('search', busca.trim());
      const dados = await api<{ leads: Lead[]; byStage: typeof porEstagio }>(
        `/api/admin/crm/leads?${params.toString()}`
      );
      setLeads(dados.leads);
      setPorEstagio(dados.byStage);
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, [soAtrasados, busca]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = useCallback(async (id: string) => {
    setAberto(id);
    try {
      const dados = await api<{ lead: Lead; activities: Atividade[] }>(`/api/admin/crm/leads/${id}`);
      setAtividades(dados.activities);
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, []);

  async function mover(lead: Lead, stage: string) {
    setOcupado(true);
    try {
      const body: Record<string, unknown> = { stage };
      if (stage === 'LOST') {
        const motivo = window.prompt('Motivo da perda:');
        if (!motivo) return;
        body.lostReason = motivo;
      }
      await api(`/api/admin/crm/leads/${lead.id}`, { method: 'PATCH', body });
      setMensagem(`${lead.name}: ${CRM_STAGE[stage] ?? stage}.`);
      await carregar();
      if (aberto === lead.id) await abrir(lead.id);
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(false);
    }
  }

  async function definirProximaAcao(lead: Lead) {
    const acao = window.prompt('Próxima ação:', lead.next_action ?? '');
    if (acao === null) return;
    const quando = window.prompt('Quando? (AAAA-MM-DD)', new Date().toISOString().slice(0, 10));
    if (!quando) return;
    try {
      await api(`/api/admin/crm/leads/${lead.id}`, {
        method: 'PATCH',
        body: { nextAction: acao || null, nextActionAt: `${quando}T12:00:00.000Z` }
      });
      setMensagem('Próxima ação atualizada.');
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }

  async function registrarAtividade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!aberto) return;
    const form = new FormData(event.currentTarget);
    try {
      const dados = await api<{ activities: Atividade[] }>(
        `/api/admin/crm/leads/${aberto}/activities`,
        { method: 'POST', body: { kind: form.get('kind'), body: form.get('body') } }
      );
      setAtividades(dados.activities);
      (event.target as HTMLFormElement).reset();
      setMensagem('Registro adicionado.');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }

  async function novoLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/admin/crm/leads', {
        method: 'POST',
        body: {
          name: form.get('name'),
          email: String(form.get('email') ?? '') || undefined,
          phone: String(form.get('phone') ?? '') || undefined,
          source: 'MANUAL',
          nextAction: String(form.get('nextAction') ?? '') || undefined
        }
      });
      (event.target as HTMLFormElement).reset();
      setMensagem('Card criado.');
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }

  const leadAberto = leads.find((l) => l.id === aberto);
  const atrasados = leads.filter((l) => l.atrasado).length;

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">CRM</p>
          <h1>Funil de oportunidades.</h1>
        </div>
        <div className="filter-row">
          <input
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, e-mail ou telefone"
            value={busca}
          />
          <button
            className={soAtrasados ? 'chip on' : 'chip'}
            onClick={() => setSoAtrasados((v) => !v)}
            type="button"
          >
            Atrasados {atrasados > 0 ? `(${atrasados})` : ''}
          </button>
        </div>
      </header>

      <section className="stat-grid compact">
        {ORDEM.map((estagio) => {
          const linha = porEstagio.find((s) => s.stage === estagio);
          return (
            <div className="stat-tile" key={estagio}>
              <span className="stat-label">{CRM_STAGE[estagio] ?? estagio}</span>
              <strong className="stat-value">{linha?.total ?? 0}</strong>
              <small className="stat-hint">{brl(linha?.valor ?? 0)}</small>
            </div>
          );
        })}
      </section>

      <div className="kanban">
        {ORDEM.map((estagio) => {
          const doEstagio = leads.filter((l) => l.stage === estagio);
          return (
            <section className="kanban-col" key={estagio}>
              <h2>
                {CRM_STAGE[estagio] ?? estagio} <small>{doEstagio.length}</small>
              </h2>
              {doEstagio.map((lead) => (
                <article
                  className={lead.atrasado ? 'lead-card late' : 'lead-card'}
                  key={lead.id}
                  style={{ borderLeftColor: lead.unidade_cor ?? '#587276' }}
                >
                  <button className="lead-open" onClick={() => void abrir(lead.id)} type="button">
                    <strong>{lead.name}</strong>
                    {lead.unidade && <small>{lead.unidade}</small>}
                    {lead.check_in && (
                      <small>
                        {shortDate(lead.check_in)}
                        {lead.check_out ? ` → ${shortDate(lead.check_out)}` : ''}
                      </small>
                    )}
                    {lead.estimated_amount && <b>{brl(lead.estimated_amount)}</b>}
                    {lead.next_action && (
                      <em className={lead.atrasado ? 'tag bad' : 'tag warn'}>
                        {lead.next_action}
                        {lead.next_action_at
                          ? ` · ${new Date(lead.next_action_at).toLocaleDateString('pt-BR')}`
                          : ''}
                      </em>
                    )}
                  </button>
                  <div className="lead-actions">
                    <select
                      disabled={ocupado}
                      onChange={(e) => void mover(lead, e.target.value)}
                      value={lead.stage}
                    >
                      {ORDEM.map((s) => (
                        <option key={s} value={s}>
                          {CRM_STAGE[s] ?? s}
                        </option>
                      ))}
                    </select>
                    <button className="text-button" onClick={() => void definirProximaAcao(lead)} type="button">
                      Próxima ação
                    </button>
                  </div>
                </article>
              ))}
              {!doEstagio.length && <p className="hint">—</p>}
            </section>
          );
        })}
      </div>

      <div className="account-grid">
        <section className="panel">
          <h2>Novo card</h2>
          <form onSubmit={novoLead}>
            <label>
              Nome
              <input name="name" required minLength={2} maxLength={160} />
            </label>
            <label>
              E-mail
              <input name="email" type="email" />
            </label>
            <label>
              Telefone
              <input name="phone" type="tel" maxLength={32} />
            </label>
            <label>
              Próxima ação
              <input name="nextAction" maxLength={200} placeholder="Ligar para confirmar datas" />
            </label>
            <button className="button" type="submit">
              Criar card
            </button>
            <p className="hint">
              Reservas feitas pelo site abrem card sozinhas e mudam de estágio conforme o contrato
              e o pagamento. Este formulário é para contato que chegou por fora — WhatsApp,
              indicação, telefone.
            </p>
          </form>
        </section>

        <section className="panel">
          <h2>{leadAberto ? leadAberto.name : 'Histórico'}</h2>
          {!leadAberto ? (
            <p className="hint">Escolha um card para ver e registrar o histórico.</p>
          ) : (
            <>
              <dl className="facts stacked">
                <div>
                  <dt>Contato</dt>
                  <dd>{[leadAberto.email, leadAberto.phone].filter(Boolean).join(' · ') || '—'}</dd>
                </div>
                <div>
                  <dt>Origem</dt>
                  <dd>{leadAberto.source}</dd>
                </div>
                {leadAberto.lost_reason && (
                  <div>
                    <dt>Motivo da perda</dt>
                    <dd>{leadAberto.lost_reason}</dd>
                  </div>
                )}
              </dl>

              <form onSubmit={registrarAtividade}>
                <label>
                  Tipo
                  <select name="kind" defaultValue="WHATSAPP">
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="CALL">Ligação</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="MEETING">Reunião</option>
                    <option value="NOTE">Anotação</option>
                  </select>
                </label>
                <label>
                  O que aconteceu
                  <textarea name="body" rows={2} required maxLength={4000} />
                </label>
                <button className="button button-small" type="submit">
                  Registrar
                </button>
              </form>

              <div className="timeline">
                {atividades.map((item) => (
                  <div key={item.id}>
                    <small>
                      {new Date(item.created_at).toLocaleString('pt-BR')} ·{' '}
                      {item.autor ?? 'automático'} · {item.kind}
                    </small>
                    <p>{item.body}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {mensagem && (
        <p className="feedback" role="status">
          {mensagem}
        </p>
      )}
    </>
  );
}
