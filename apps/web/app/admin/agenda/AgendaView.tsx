'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/api';
import { PAYMENT_LABEL, STATUS_LABEL, brl, longDate, shortDate } from '@/lib/format';

type Reserva = {
  id: string;
  check_in: string;
  check_out: string;
  status: string;
  payment_status: string;
  guest_count: number;
  total_amount: string;
  deposit_amount: string;
  pago: string;
  unit_slug: string;
  unit_name: string;
  unit_color: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  payment_reference: string | null;
  contract_status: string | null;
  contract_signed_at: string | null;
  staff_notes: string | null;
  guest_request: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  source: string;
};

type Unidade = { slug: string; shortName: string; color: string };

const JANELAS = [
  { label: 'Próximos 30 dias', de: 0, ate: 30 },
  { label: 'Este mês', de: -15, ate: 45 },
  { label: 'Próximos 6 meses', de: 0, ate: 182 },
  { label: 'Histórico', de: -365, ate: 365 }
];

function iso(offset: number): string {
  const data = new Date();
  data.setUTCDate(data.getUTCDate() + offset);
  return data.toISOString().slice(0, 10);
}

const hoje = () => new Date().toISOString().slice(0, 10);

export default function AgendaView({ units }: { units: Unidade[] }) {
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [janela, setJanela] = useState(JANELAS[0]!);
  const [unidade, setUnidade] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState('Carregando agenda...');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const filtro = unidade ? `&unit=${unidade}` : '';
      const dados = await api<{ reservations: Reserva[] }>(
        `/api/admin/reservations?from=${iso(janela.de)}&to=${iso(janela.ate)}${filtro}`
      );
      setReservas(dados.reservations);
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, [janela, unidade]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvarObservacoes(reserva: Reserva, campos: Record<string, string | null>) {
    setOcupado(reserva.id);
    try {
      await api(`/api/admin/reservations/${reserva.id}/notes`, { method: 'PATCH', body: campos });
      setMensagem('Observações salvas.');
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  async function registrarEstadia(reserva: Reserva, event: 'CHECK_IN' | 'CHECK_OUT' | 'UNDO') {
    setOcupado(reserva.id);
    try {
      await api(`/api/admin/reservations/${reserva.id}/stay`, { method: 'POST', body: { event } });
      setMensagem(
        event === 'CHECK_IN' ? 'Chegada registrada.' :
        event === 'CHECK_OUT' ? 'Saída registrada.' : 'Registro desfeito.'
      );
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  async function confirmarPagamento(reserva: Reserva, status: 'PAID' | 'PARTIAL') {
    const sugerido = status === 'PAID' ? reserva.total_amount : reserva.deposit_amount;
    const bruto = window.prompt('Valor recebido (R$):', Number(sugerido).toFixed(2));
    if (!bruto) return;
    const amount = Number(bruto.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      setMensagem('Valor inválido.');
      return;
    }
    setOcupado(reserva.id);
    try {
      await api(`/api/admin/reservations/${reserva.id}/confirm-payment`, {
        method: 'POST',
        body: { amount, status, note: `Conciliado na agenda (${reserva.payment_reference ?? 'sem referência'})` }
      });
      setMensagem(status === 'PAID' ? 'Pagamento total confirmado.' : 'Sinal confirmado.');
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  async function cancelar(reserva: Reserva) {
    const motivo = window.prompt('Motivo do cancelamento (mínimo 3 caracteres):');
    if (!motivo || motivo.trim().length < 3) return;
    const refund = window.confirm('Marcar o pagamento como reembolsado?');
    setOcupado(reserva.id);
    try {
      await api(`/api/admin/reservations/${reserva.id}/cancel`, {
        method: 'POST',
        body: { reason: motivo.trim(), refund }
      });
      setMensagem('Reserva cancelada.');
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  // Chegadas e saídas de hoje ficam no topo: é o que a operação precisa ver
  // antes de qualquer outra coisa.
  const chegamHoje = reservas.filter((r) => r.check_in === hoje() && !r.checked_in_at);
  const saemHoje = reservas.filter((r) => r.check_out === hoje() && !r.checked_out_at);

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Agenda</p>
          <h1>Quem chega e quem sai.</h1>
        </div>
        <div className="filter-row">
          {JANELAS.map((opcao) => (
            <button
              className={opcao.label === janela.label ? 'chip on' : 'chip'}
              key={opcao.label}
              onClick={() => setJanela(opcao)}
              type="button"
            >
              {opcao.label}
            </button>
          ))}
          <select value={unidade ?? ''} onChange={(e) => setUnidade(e.target.value || null)}>
            <option value="">Todos os espaços</option>
            {units.map((u) => (
              <option key={u.slug} value={u.slug}>
                {u.shortName}
              </option>
            ))}
          </select>
        </div>
      </header>

      {(chegamHoje.length > 0 || saemHoje.length > 0) && (
        <section className="panel attention">
          <h2>Hoje</h2>
          <div className="attention-grid">
            {chegamHoje.map((r) => (
              <span className="tag" key={`in-${r.id}`}>
                Chega: {r.customer_name} · {r.unit_name}
              </span>
            ))}
            {saemHoje.map((r) => (
              <span className="tag warn" key={`out-${r.id}`}>
                Sai: {r.customer_name} · {r.unit_name}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="admin-heading">
          <h2>{reservas.length} reserva(s)</h2>
          <button className="button button-small" type="button" onClick={() => void carregar()}>
            Atualizar
          </button>
        </div>

        {reservas.length ? (
          <div className="agenda-list">
            {reservas.map((reserva) => {
              const expandida = aberta === reserva.id;
              const saldo = Number(reserva.total_amount) - Number(reserva.pago ?? 0);
              return (
                <article
                  className={expandida ? 'agenda-item open' : 'agenda-item'}
                  key={reserva.id}
                  style={{ borderLeftColor: reserva.unit_color ?? '#1F3A5F' }}
                >
                  <button
                    aria-expanded={expandida}
                    className="agenda-summary"
                    onClick={() => setAberta(expandida ? null : reserva.id)}
                    type="button"
                  >
                    <span className="agenda-dates">
                      <strong>{shortDate(reserva.check_in)}</strong>
                      <small>até {shortDate(reserva.check_out)}</small>
                    </span>
                    <span className="agenda-main">
                      <strong>{reserva.customer_name}</strong>
                      <small>
                        {reserva.unit_name} · {reserva.guest_count}{' '}
                        {reserva.guest_count === 1 ? 'hóspede' : 'hóspedes'}
                      </small>
                    </span>
                    <span className="agenda-state">
                      <small>{STATUS_LABEL[reserva.status] ?? reserva.status}</small>
                      <small>{PAYMENT_LABEL[reserva.payment_status] ?? reserva.payment_status}</small>
                    </span>
                    <span className="agenda-money">
                      <strong>{brl(reserva.total_amount)}</strong>
                      {saldo > 0 && <small>falta {brl(saldo)}</small>}
                    </span>
                    <span className="agenda-flags">
                      {reserva.checked_in_at && <em className="tag good">chegou</em>}
                      {reserva.checked_out_at && <em className="tag">saiu</em>}
                      {reserva.contract_status === 'SIGNED' ? (
                        <em className="tag good">contrato ok</em>
                      ) : (
                        <em className="tag warn">sem contrato</em>
                      )}
                    </span>
                  </button>

                  {expandida && (
                    <div className="agenda-detail">
                      <dl className="facts stacked">
                        <div>
                          <dt>Entrada</dt>
                          <dd>{longDate(reserva.check_in)} a partir das 09:00</dd>
                        </div>
                        <div>
                          <dt>Saída</dt>
                          <dd>{longDate(reserva.check_out)} até as 16:00</dd>
                        </div>
                        <div>
                          <dt>Contato</dt>
                          <dd>
                            {reserva.customer_email}
                            {reserva.customer_phone ? ` · ${reserva.customer_phone}` : ''}
                          </dd>
                        </div>
                        <div>
                          <dt>Pago</dt>
                          <dd>
                            {brl(reserva.pago ?? 0)} de {brl(reserva.total_amount)}
                            {reserva.payment_reference ? ` · ref. ${reserva.payment_reference}` : ''}
                          </dd>
                        </div>
                        <div>
                          <dt>Contrato</dt>
                          <dd>
                            {reserva.contract_signed_at
                              ? `assinado em ${new Date(reserva.contract_signed_at).toLocaleString('pt-BR')}`
                              : (reserva.contract_status ?? 'não emitido')}
                          </dd>
                        </div>
                        <div>
                          <dt>Origem</dt>
                          <dd>{reserva.source}</dd>
                        </div>
                      </dl>

                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          void salvarObservacoes(reserva, {
                            staffNotes: String(form.get('staffNotes') ?? '') || null,
                            guestRequest: String(form.get('guestRequest') ?? '') || null
                          });
                        }}
                      >
                        <label>
                          Observação interna
                          <textarea
                            name="staffNotes"
                            rows={3}
                            defaultValue={reserva.staff_notes ?? ''}
                            placeholder="Chaves, horário combinado, recados da equipe..."
                          />
                        </label>
                        <label>
                          Pedido do hóspede
                          <textarea
                            name="guestRequest"
                            rows={2}
                            defaultValue={reserva.guest_request ?? ''}
                            placeholder="Berço, chegada tarde, restrição alimentar..."
                          />
                        </label>
                        <button className="button button-small" type="submit" disabled={ocupado === reserva.id}>
                          Salvar observações
                        </button>
                      </form>

                      <div className="admin-actions wide">
                        {!reserva.checked_in_at && (
                          <button className="text-button" type="button" disabled={ocupado === reserva.id}
                            onClick={() => void registrarEstadia(reserva, 'CHECK_IN')}>
                            Registrar chegada
                          </button>
                        )}
                        {reserva.checked_in_at && !reserva.checked_out_at && (
                          <button className="text-button" type="button" disabled={ocupado === reserva.id}
                            onClick={() => void registrarEstadia(reserva, 'CHECK_OUT')}>
                            Registrar saída
                          </button>
                        )}
                        {(reserva.checked_in_at || reserva.checked_out_at) && (
                          <button className="text-button" type="button" disabled={ocupado === reserva.id}
                            onClick={() => void registrarEstadia(reserva, 'UNDO')}>
                            Desfazer registro
                          </button>
                        )}
                        {reserva.payment_status !== 'PAID' &&
                          ['PENDING_PAYMENT', 'CONFIRMED'].includes(reserva.status) && (
                            <>
                              <button className="text-button" type="button" disabled={ocupado === reserva.id}
                                onClick={() => void confirmarPagamento(reserva, 'PARTIAL')}>
                                Sinal recebido
                              </button>
                              <button className="text-button" type="button" disabled={ocupado === reserva.id}
                                onClick={() => void confirmarPagamento(reserva, 'PAID')}>
                                Pago integral
                              </button>
                            </>
                          )}
                        {['PENDING_PAYMENT', 'CONFIRMED'].includes(reserva.status) && (
                          <button className="text-button" type="button" disabled={ocupado === reserva.id}
                            onClick={() => void cancelar(reserva)}>
                            Cancelar reserva
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="hint">Nenhuma reserva nesta janela.</p>
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
