'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/api';
import { CHARGE_STATUS, METHOD_LABEL, STATUS_LABEL, brl, shortDate } from '@/lib/format';

type Cliente = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  document_number: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  created_at: string;
  reservas: string;
  estadias: string;
  pagamentos: string;
  total_pago: string;
  em_aberto: string;
  atrasados: string;
  ultima_estadia: string | null;
  proxima_estadia: string | null;
};

type Detalhe = {
  customer: Cliente & {
    rg: string | null; rg_issuer: string | null; profession: string | null;
    address_line: string | null; address_city: string | null; address_state: string | null;
    address_zip: string | null; notes: string | null; last_login_at: string | null;
  };
  reservations: {
    id: string; check_in: string; check_out: string; status: string; payment_status: string;
    guest_count: number; total_amount: string; unidade: string; color: string;
    checked_in_at: string | null; checked_out_at: string | null;
  }[];
  payments: {
    id: string; reference: string; amount: string; status: string; method: string; kind: string;
    due_date: string | null; paid_at: string | null; check_in: string;
  }[];
  contracts: {
    id: string; status: string; template_version: string; signed_at: string | null;
    signature_hash: string | null; check_in: string; check_out: string;
  }[];
};

export default function ClientesView() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [mensagem, setMensagem] = useState('Carregando clientes...');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const filtro = busca.trim() ? `?search=${encodeURIComponent(busca.trim())}` : '';
      const dados = await api<{ customers: Cliente[]; total: number }>(`/api/admin/customers${filtro}`);
      setClientes(dados.customers);
      setTotal(dados.total);
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, [busca]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = useCallback(async (id: string) => {
    setSelecionado(id);
    setDetalhe(null);
    try {
      setDetalhe(await api<Detalhe>(`/api/admin/customers/${id}`));
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, []);

  /**
   * Registra um pagamento recebido fora do site.
   *
   * Acontece o tempo todo: o hóspede paga por Pix direto, por transferência ou
   * em dinheiro, e alguém precisa dar baixa. A reserva volta a segurar a data
   * — se o hold já tinha expirado, o bloqueio é recriado; se outra pessoa
   * comprou aquelas noites nesse meio-tempo, a operação é recusada em vez de
   * confirmar uma estadia que não cabe mais.
   */
  async function marcarPago(reserva: Detalhe['reservations'][number], quitado: boolean) {
    const sugerido = Number(reserva.total_amount);
    const bruto = window.prompt(
      `Valor recebido de ${detalhe?.customer.full_name ?? 'este hóspede'} (R$):`,
      quitado ? sugerido.toFixed(2) : (sugerido / 2).toFixed(2)
    );
    if (!bruto) return;
    const amount = Number(bruto.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      setMensagem('Valor inválido.');
      return;
    }

    const forma = window.prompt(
      'Como foi pago?\n\n1 = Pix   2 = Transferência   3 = Dinheiro   4 = Cartão',
      '1'
    );
    const metodo = { '1': 'PIX', '2': 'TRANSFER', '3': 'CASH', '4': 'CREDIT_CARD' }[
      (forma ?? '1').trim()
    ];
    if (!metodo) return;

    setOcupado(reserva.id);
    try {
      await api(`/api/admin/reservations/${reserva.id}/confirm-payment`, {
        method: 'POST',
        body: {
          amount,
          status: quitado ? 'PAID' : 'PARTIAL',
          method: metodo,
          note: 'Recebido fora do site, registrado pelo painel de clientes.'
        }
      });
      setMensagem(
        quitado ? 'Pagamento total registrado.' : 'Sinal registrado. A data segue reservada.'
      );
      if (selecionado) await abrir(selecionado);
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  async function salvarNota(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selecionado) return;
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/admin/customers/${selecionado}`, {
        method: 'PATCH',
        body: { notes: String(form.get('notes') ?? '') || null }
      });
      setMensagem('Anotação salva.');
      await abrir(selecionado);
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Clientes</p>
          <h1>Quem já ficou com vocês.</h1>
        </div>
        <div className="filter-row">
          <input
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, e-mail, telefone ou CPF"
            value={busca}
          />
        </div>
      </header>

      <div className="split-view">
        <section className="panel">
          <h2>{total} cadastro(s)</h2>
          <div className="customer-list">
            {clientes.map((cliente) => (
              <button
                className={cliente.id === selecionado ? 'customer-row on' : 'customer-row'}
                key={cliente.id}
                onClick={() => void abrir(cliente.id)}
                type="button"
              >
                <span className="avatar" aria-hidden>
                  {cliente.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={cliente.avatar_url} />
                  ) : (
                    cliente.full_name.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="customer-main">
                  <strong>{cliente.full_name}</strong>
                  <small>{cliente.email}</small>
                </span>
                <span className="customer-stats">
                  <small>
                    {cliente.estadias} estadia(s) · {cliente.pagamentos} pagamento(s)
                  </small>
                  <strong>{brl(cliente.total_pago)}</strong>
                  {Number(cliente.atrasados) > 0 && (
                    <em className="tag bad">{cliente.atrasados} em atraso</em>
                  )}
                  {cliente.role === 'ADMIN' && <em className="tag">admin</em>}
                </span>
              </button>
            ))}
            {!clientes.length && <p className="hint">Nenhum cliente encontrado.</p>}
          </div>
        </section>

        <section className="panel">
          {!selecionado ? (
            <p className="hint">Escolha um cliente para ver a ficha.</p>
          ) : !detalhe ? (
            <p>Carregando ficha...</p>
          ) : (
            <>
              <h2>{detalhe.customer.full_name}</h2>
              <dl className="facts stacked">
                <div>
                  <dt>Contato</dt>
                  <dd>
                    {detalhe.customer.email}
                    {detalhe.customer.phone ? ` · ${detalhe.customer.phone}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Documento</dt>
                  <dd>
                    {detalhe.customer.document_number ?? '—'}
                    {detalhe.customer.rg ? ` · RG ${detalhe.customer.rg} ${detalhe.customer.rg_issuer ?? ''}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Endereço</dt>
                  <dd>
                    {detalhe.customer.address_line
                      ? `${detalhe.customer.address_line}, ${detalhe.customer.address_city}/${detalhe.customer.address_state} — ${detalhe.customer.address_zip}`
                      : 'não informado'}
                  </dd>
                </div>
                <div>
                  <dt>Total pago</dt>
                  <dd>{brl(detalhe.customer.total_pago)}</dd>
                </div>
                <div>
                  <dt>Em aberto</dt>
                  <dd>{brl(detalhe.customer.em_aberto)}</dd>
                </div>
                <div>
                  <dt>Última estadia</dt>
                  <dd>
                    {detalhe.customer.ultima_estadia
                      ? shortDate(detalhe.customer.ultima_estadia)
                      : 'nunca ficou'}
                  </dd>
                </div>
              </dl>

              <h2 className="sub">Estadias ({detalhe.reservations.length})</h2>
              {detalhe.reservations.length ? (
                <table className="data-table">
                  <tbody>
                    {detalhe.reservations.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <i className="unit-dot" style={{ background: r.color }} />
                          {r.unidade}
                        </td>
                        <td>
                          {shortDate(r.check_in)} → {shortDate(r.check_out)}
                        </td>
                        <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                        <td>{brl(r.total_amount)}</td>
                        <td className="row-end">
                          {r.payment_status === 'PAID' ? (
                            <em className="tag good">pago</em>
                          ) : (
                            <span className="stack-actions">
                              <button
                                className="text-button"
                                type="button"
                                disabled={ocupado === r.id}
                                onClick={() => void marcarPago(r, true)}
                              >
                                {ocupado === r.id ? 'Registrando...' : 'Marcar como pago'}
                              </button>
                              {r.payment_status !== 'PARTIAL' && (
                                <button
                                  className="text-button quiet"
                                  type="button"
                                  disabled={ocupado === r.id}
                                  onClick={() => void marcarPago(r, false)}
                                >
                                  Só o sinal
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="hint">Nenhuma estadia registrada.</p>
              )}

              <h2 className="sub">Pagamentos ({detalhe.payments.length})</h2>
              {detalhe.payments.length ? (
                <table className="data-table">
                  <tbody>
                    {detalhe.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{p.reference}</td>
                        <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                        <td>
                          <em className={`tag ${CHARGE_STATUS[p.status]?.tone ?? ''}`}>
                            {CHARGE_STATUS[p.status]?.label ?? p.status}
                          </em>
                        </td>
                        <td>{brl(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="hint">Nenhuma cobrança.</p>
              )}

              <h2 className="sub">Contratos ({detalhe.contracts.length})</h2>
              {detalhe.contracts.length ? (
                <table className="data-table">
                  <tbody>
                    {detalhe.contracts.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {shortDate(c.check_in)} → {shortDate(c.check_out)}
                        </td>
                        <td>{c.template_version}</td>
                        <td>
                          {c.signed_at
                            ? `assinado ${new Date(c.signed_at).toLocaleDateString('pt-BR')}`
                            : c.status}
                        </td>
                        <td>
                          {c.signature_hash ? (
                            <code title={c.signature_hash}>{c.signature_hash.slice(0, 10)}…</code>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="hint">Nenhum contrato emitido.</p>
              )}

              <form onSubmit={salvarNota}>
                <label>
                  Anotações internas
                  <textarea
                    key={detalhe.customer.id}
                    name="notes"
                    rows={3}
                    defaultValue={detalhe.customer.notes ?? ''}
                    placeholder="Preferências, histórico, cuidados..."
                  />
                </label>
                <button className="button button-small" type="submit">
                  Salvar anotação
                </button>
              </form>
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
