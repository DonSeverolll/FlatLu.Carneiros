'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart, Meter, StatTile } from '../Charts';
import { api, messageFor } from '@/lib/api';
import { PAYMENT_LABEL, STATUS_LABEL, brl, shortDate } from '@/lib/format';

type Dashboard = {
  range: { from: string; to: string; granularity: string; unit: string | null };
  resumo: {
    recebido: number;
    aReceber: number;
    reservasCriadas: number;
    reservasConfirmadas: number;
    conversao: number;
    noitesVendidas: number;
    diariaMedia: number;
    ocupacao: number;
  };
  serie: { periodo: string; recebido: string; reservas: string; check_ins: string; check_outs: string }[];
  porUnidade: { slug: string; unidade: string; color: string; recebido: string; reservas: string; noites: string }[];
  ocupacaoPorUnidade: { slug: string; unidade: string; noites_ocupadas: string; noites_periodo: string; percentual: number }[];
  proximos: {
    id: string; check_in: string; check_out: string; status: string; payment_status: string;
    guest_count: number; total_amount: string; unidade: string; color: string;
    hospede: string; phone: string | null; checked_in_at: string | null; checked_out_at: string | null;
  }[];
  atencao: Record<string, string>;
  origem: { origem: string; total: string }[];
};

const PERIODOS = [
  { label: '7 dias', dias: 6, granularidade: 'day' },
  { label: '30 dias', dias: 29, granularidade: 'day' },
  { label: '90 dias', dias: 89, granularidade: 'week' },
  { label: '12 meses', dias: 364, granularidade: 'month' }
];

function isoAtras(dias: number): string {
  const data = new Date();
  data.setUTCDate(data.getUTCDate() - dias);
  return data.toISOString().slice(0, 10);
}

const hoje = () => new Date().toISOString().slice(0, 10);

export default function DashboardView() {
  const [dados, setDados] = useState<Dashboard | null>(null);
  const [periodo, setPeriodo] = useState(PERIODOS[1]!);
  const [unidade, setUnidade] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const filtro = unidade ? `&unit=${unidade}` : '';
      const dados = await api<Dashboard>(
        `/api/admin/dashboard?from=${isoAtras(periodo.dias)}&to=${hoje()}` +
          `&granularity=${periodo.granularidade}${filtro}`
      );
      setDados(dados);
    } catch (error) {
      setErro(messageFor(error));
    }
  }, [periodo, unidade]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <p className="feedback">{erro}</p>;
  if (!dados) return <p>Carregando indicadores...</p>;

  const { resumo, atencao } = dados;
  const pendencias = Number(atencao.pagamentos_atrasados ?? 0) +
    Number(atencao.contratos_pendentes ?? 0) +
    Number(atencao.crm_atrasado ?? 0);

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Como andam as vendas.</h1>
        </div>
        <div className="filter-row">
          {PERIODOS.map((opcao) => (
            <button
              className={opcao.label === periodo.label ? 'chip on' : 'chip'}
              key={opcao.label}
              onClick={() => setPeriodo(opcao)}
              type="button"
            >
              {opcao.label}
            </button>
          ))}
          <select value={unidade ?? ''} onChange={(e) => setUnidade(e.target.value || null)}>
            <option value="">Todos os espaços</option>
            {dados.porUnidade.map((u) => (
              <option key={u.slug} value={u.slug}>
                {u.unidade}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* O que exige ação vem primeiro: painel serve para decidir, não para admirar. */}
      {pendencias > 0 && (
        <section className="panel attention">
          <h2>Precisa de você</h2>
          <div className="attention-grid">
            {Number(atencao.pagamentos_atrasados) > 0 && (
              <span className="tag bad">{atencao.pagamentos_atrasados} pagamento(s) em atraso</span>
            )}
            {Number(atencao.contratos_pendentes) > 0 && (
              <span className="tag warn">{atencao.contratos_pendentes} contrato(s) sem assinatura</span>
            )}
            {Number(atencao.holds_expirando) > 0 && (
              <span className="tag warn">{atencao.holds_expirando} reserva(s) expirando em 2h</span>
            )}
            {Number(atencao.crm_atrasado) > 0 && (
              <Link className="tag warn" href="/admin/crm?overdueOnly=true">
                {atencao.crm_atrasado} follow-up(s) atrasado(s)
              </Link>
            )}
            {Number(atencao.a_concluir) > 0 && (
              <Link className="tag" href="/admin/agenda">
                {atencao.a_concluir} estadia(s) a encerrar
              </Link>
            )}
          </div>
        </section>
      )}

      <section className="stat-grid">
        <StatTile label="Recebido no período" value={brl(resumo.recebido)} hint="pagamentos compensados" />
        <StatTile label="A receber" value={brl(resumo.aReceber)} hint="cobranças em aberto" />
        <StatTile label="Ocupação" value={`${resumo.ocupacao}%`} hint="noites ocupadas no período" />
        <StatTile label="Diária média" value={brl(resumo.diariaMedia)} hint="recebido ÷ noites vendidas" />
        <StatTile
          label="Conversão"
          value={`${resumo.conversao}%`}
          hint={`${resumo.reservasConfirmadas} de ${resumo.reservasCriadas} reservas`}
        />
        <StatTile label="Noites vendidas" value={String(resumo.noitesVendidas)} hint="no período" />
      </section>

      {/* Dinheiro e contagem têm escalas diferentes: dois gráficos, nunca dois eixos. */}
      <section className="panel">
        <h2>Recebido</h2>
        <BarChart
          data={dados.serie.map((p) => ({ periodo: p.periodo, valor: Number(p.recebido) }))}
          color="#C9522F"
          label="Recebido"
          currency
          granularity={dados.range.granularity}
        />
      </section>

      <section className="panel">
        <h2>Reservas feitas</h2>
        <BarChart
          data={dados.serie.map((p) => ({ periodo: p.periodo, valor: Number(p.reservas) }))}
          color="#173f45"
          label="Reservas"
          granularity={dados.range.granularity}
        />
      </section>

      <div className="account-grid">
        <section className="panel">
          <h2>Chegadas</h2>
          <BarChart
            data={dados.serie.map((p) => ({ periodo: p.periodo, valor: Number(p.check_ins) }))}
            color="#2E6F4E"
            label="Check-ins"
            granularity={dados.range.granularity}
            height={140}
          />
        </section>
        <section className="panel">
          <h2>Saídas</h2>
          <BarChart
            data={dados.serie.map((p) => ({ periodo: p.periodo, valor: Number(p.check_outs) }))}
            color="#587276"
            label="Check-outs"
            granularity={dados.range.granularity}
            height={140}
          />
        </section>
      </div>

      {/* Comparação entre unidades: tabela com barra. O nome carrega a
          identidade; a cor só reforça o que o rótulo já diz. */}
      <section className="panel">
        <h2>Por espaço</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Espaço</th>
              <th>Recebido</th>
              <th>Reservas</th>
              <th>Noites</th>
              <th>Ocupação</th>
            </tr>
          </thead>
          <tbody>
            {dados.porUnidade.map((linha) => {
              const maiorRecebido = Math.max(...dados.porUnidade.map((u) => Number(u.recebido)), 1);
              const ocup = dados.ocupacaoPorUnidade.find((o) => o.slug === linha.slug);
              return (
                <tr key={linha.slug}>
                  <td>
                    <i className="unit-dot" style={{ background: linha.color }} />
                    {linha.unidade}
                  </td>
                  <td>
                    <Meter value={Number(linha.recebido)} max={maiorRecebido} color={linha.color} />
                    <b>{brl(linha.recebido)}</b>
                  </td>
                  <td>{linha.reservas}</td>
                  <td>{linha.noites}</td>
                  <td>
                    <Meter value={ocup?.percentual ?? 0} max={100} color={linha.color} />
                    <b>{ocup?.percentual ?? 0}%</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="admin-heading">
          <h2>Próximos 14 dias</h2>
          <Link className="link" href="/admin/agenda">
            Ver agenda completa
          </Link>
        </div>
        {dados.proximos.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Espaço</th>
                <th>Hóspede</th>
                <th>Entrada</th>
                <th>Saída</th>
                <th>Situação</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {dados.proximos.map((reserva) => (
                <tr key={reserva.id}>
                  <td>
                    <i className="unit-dot" style={{ background: reserva.color }} />
                    {reserva.unidade}
                  </td>
                  <td>
                    {reserva.hospede}
                    {reserva.phone ? <small> · {reserva.phone}</small> : null}
                  </td>
                  <td>
                    {shortDate(reserva.check_in)}
                    {reserva.checked_in_at ? <small> · chegou</small> : null}
                  </td>
                  <td>
                    {shortDate(reserva.check_out)}
                    {reserva.checked_out_at ? <small> · saiu</small> : null}
                  </td>
                  <td>
                    {STATUS_LABEL[reserva.status] ?? reserva.status}
                    <small> · {PAYMENT_LABEL[reserva.payment_status] ?? reserva.payment_status}</small>
                  </td>
                  <td>{brl(reserva.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="hint">Nenhuma chegada ou saída nos próximos 14 dias.</p>
        )}
      </section>

      {dados.origem.length > 1 && (
        <section className="panel">
          <h2>De onde vêm as reservas</h2>
          <table className="data-table">
            <tbody>
              {dados.origem.map((linha) => (
                <tr key={linha.origem}>
                  <td>{linha.origem}</td>
                  <td>{linha.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
