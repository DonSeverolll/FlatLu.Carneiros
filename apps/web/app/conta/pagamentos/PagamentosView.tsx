'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, messageFor } from '@/lib/api';
import { CHARGE_KIND, CHARGE_STATUS, METHOD_LABEL, brl, longDate, shortDate } from '@/lib/format';

type Cobranca = {
  id: string;
  reference: string;
  amount: string;
  status: string;
  rawStatus: string;
  method: string;
  kind: string;
  installments: number;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
  checkout_url: string | null;
  failure_reason: string | null;
  reservation_id: string;
  check_in: string;
  check_out: string;
  unit_name: string;
  unit_color: string | null;
};

/**
 * Extrato do hóspede. A situação de cada cobrança segue o ciclo real do
 * pagamento — pendente, processando, aprovado, negado, em atraso, cancelado —
 * e "em atraso" é derivado do vencimento, não um estado que alguém precise
 * lembrar de gravar.
 */
export default function PagamentosView() {
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [mensagem, setMensagem] = useState('Carregando pagamentos...');

  const carregar = useCallback(async () => {
    try {
      const dados = await api<{ payments: Cobranca[] }>('/api/me/payments');
      setCobrancas(dados.payments);
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const totalPago = cobrancas
    .filter((c) => c.rawStatus === 'PAID' || c.rawStatus === 'PARTIAL')
    .reduce((soma, c) => soma + Number(c.amount), 0);
  const emAberto = cobrancas
    .filter((c) => ['PENDING', 'PROCESSING'].includes(c.rawStatus))
    .reduce((soma, c) => soma + Number(c.amount), 0);

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Minha conta</p>
          <h1>Pagamentos.</h1>
        </div>
      </header>

      {mensagem && <p className="feedback">{mensagem}</p>}

      {cobrancas.length > 0 && (
        <section className="stat-grid">
          <div className="stat-tile good">
            <span className="stat-label">Total pago</span>
            <strong className="stat-value">{brl(totalPago)}</strong>
          </div>
          <div className="stat-tile warn">
            <span className="stat-label">Em aberto</span>
            <strong className="stat-value">{brl(emAberto)}</strong>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Cobranças</span>
            <strong className="stat-value">{cobrancas.length}</strong>
          </div>
        </section>
      )}

      <section className="panel">
        {cobrancas.length ? (
          <div className="charge-list">
            {cobrancas.map((cobranca) => {
              const estado = CHARGE_STATUS[cobranca.status] ?? { label: cobranca.status, tone: '' };
              const pagavel = ['PENDING', 'OVERDUE', 'DECLINED'].includes(cobranca.status);
              return (
                <article
                  className="charge"
                  key={cobranca.id}
                  style={{ borderLeftColor: cobranca.unit_color ?? '#1F3A5F' }}
                >
                  <div className="charge-main">
                    <strong>
                      {CHARGE_KIND[cobranca.kind] ?? cobranca.kind} · {cobranca.unit_name}
                    </strong>
                    <small>
                      Estadia {shortDate(cobranca.check_in)} → {shortDate(cobranca.check_out)}
                    </small>
                    <small>
                      {METHOD_LABEL[cobranca.method] ?? cobranca.method}
                      {cobranca.installments > 1 ? ` em ${cobranca.installments}x` : ''} · ref.{' '}
                      {cobranca.reference}
                    </small>
                    {cobranca.failure_reason && (
                      <small className="charge-reason">{cobranca.failure_reason}</small>
                    )}
                  </div>

                  <div className="charge-side">
                    <b>{brl(cobranca.amount)}</b>
                    <em className={`tag ${estado.tone}`}>{estado.label}</em>
                    {cobranca.paid_at ? (
                      <small>pago em {new Date(cobranca.paid_at).toLocaleDateString('pt-BR')}</small>
                    ) : cobranca.due_date ? (
                      <small>vence {longDate(cobranca.due_date)}</small>
                    ) : null}
                    {pagavel && (
                      <Link className="button small" href={`/reserva/${cobranca.reservation_id}`}>
                        Pagar agora
                      </Link>
                    )}
                    {cobranca.status === 'PROCESSING' && cobranca.checkout_url && (
                      <a className="link" href={cobranca.checkout_url} rel="noreferrer" target="_blank">
                        Acompanhar no provedor
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          !mensagem && (
            <p className="hint">
              Nenhuma cobrança ainda. <Link href="/#reserva">Consultar datas</Link>
            </p>
          )
        )}
      </section>
    </>
  );
}
