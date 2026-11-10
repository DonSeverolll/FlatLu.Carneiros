'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/api';
import { ORIGEM_CANAL, PAYMENT_LABEL, STATUS_LABEL, brl, shortDate } from '@/lib/format';

type Anuncio = {
  ad_id: string;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  spend: string;
  impressions: string;
  clicks: string;
  link_clicks: string;
  leads_meta: string;
  conversas_meta: string;
  leads: string;
  reservas: string;
  confirmadas: string;
  valor_reservado: string;
  recebido: string;
};

type ReservaAtribuida = {
  id: string;
  check_in: string;
  check_out: string;
  status: string;
  payment_status: string;
  total_amount: string;
  created_at: string;
  ad_id: string;
  origem_canal: string | null;
  hospede: string;
  unidade: string;
  unidade_cor: string | null;
  ad_name: string | null;
  campaign_name: string | null;
};

type Relatorio = {
  periodo: { de: string; ate: string };
  anuncios: Anuncio[];
  porCanal: { canal: string; leads: string; com_reserva: string }[];
  reservas: ReservaAtribuida[];
  sincronizacoes: { tipo: string; iniciado_em: string; ok: boolean | null; detalhe: Record<string, unknown> }[];
  configurado: { anuncios: boolean; instagram: boolean };
};

const PERIODOS = [7, 30, 90];

/** Parâmetros de URL para o anúncio. A Meta troca os `{{...}}` pelos valores reais. */
const URL_TEMPLATE =
  'utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}' +
  '&utm_content={{ad.name}}&ad_id={{ad.id}}&adset_id={{adset.id}}&campaign_id={{campaign.id}}';

function isoDiasAtras(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() - (dias - 1));
  return d.toISOString().slice(0, 10);
}

const n = (v: string | number) => Number(v) || 0;
const inteiro = (v: string | number) => n(v).toLocaleString('pt-BR');

/** Razão só quando o denominador existe: "R$ 0" de CPL sem lead mentiria. */
function razao(numerador: number, denominador: number, formato: (x: number) => string) {
  return denominador > 0 ? formato(numerador / denominador) : '—';
}

/**
 * Retorno por anúncio. O gasto vem da Meta; lead, reserva e dinheiro recebido
 * vêm do nosso banco, ligados pelo `ad_id` capturado na chegada ao site ou na
 * conversa de click-to-WhatsApp/Direct.
 */
export default function MarketingView() {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [mensagem, setMensagem] = useState('Carregando...');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api<Relatorio>(`/api/admin/marketing?de=${isoDiasAtras(dias)}`);
      setDados(r);
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, [dias]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function sincronizar(escopo: 'anuncios' | 'instagram') {
    setOcupado(true);
    setMensagem(escopo === 'anuncios' ? 'Buscando métricas na Meta...' : 'Importando o Direct...');
    try {
      const r = await api<Record<string, unknown>>('/api/admin/marketing/sync', {
        method: 'POST',
        body: { escopo, dias: Math.max(dias, 30) }
      });
      setMensagem(
        escopo === 'anuncios'
          ? `Métricas atualizadas (${r.gravadas ?? 0} linhas de anúncio/dia).`
          : `Direct importado: ${r.mensagens ?? 0} mensagens novas em ${r.conversas ?? 0} conversas.`
      );
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(false);
    }
  }

  const totais = (dados?.anuncios ?? []).reduce(
    (t, a) => ({
      gasto: t.gasto + n(a.spend),
      cliques: t.cliques + n(a.link_clicks || a.clicks),
      leads: t.leads + n(a.leads),
      reservas: t.reservas + n(a.reservas),
      confirmadas: t.confirmadas + n(a.confirmadas),
      recebido: t.recebido + n(a.recebido)
    }),
    { gasto: 0, cliques: 0, leads: 0, reservas: 0, confirmadas: 0, recebido: 0 }
  );
  // Sem conta de anúncios ligada o gasto é desconhecido, não zero: custo por
  // lead/reserva de "R$ 0" seria uma mentira com cara de ótima notícia.
  const custo = (gasto: number, base: number) =>
    dados?.configurado.anuncios ? razao(gasto, base, brl) : '—';
  const maxCanal = Math.max(1, ...(dados?.porCanal ?? []).map((c) => n(c.leads)));
  const syncAnuncios = dados?.sincronizacoes.find((s) => s.tipo === 'ANUNCIOS');

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Marketing</p>
          <h1>De onde vêm as reservas.</h1>
        </div>
        <div className="filter-row">
          {PERIODOS.map((p) => (
            <button className={dias === p ? 'chip on' : 'chip'} key={p} onClick={() => setDias(p)} type="button">
              {p} dias
            </button>
          ))}
          <button
            className="chip"
            disabled={ocupado || !dados?.configurado.anuncios}
            onClick={() => void sincronizar('anuncios')}
            title={dados?.configurado.anuncios ? '' : 'Defina META_ADS_ACCESS_TOKEN e META_AD_ACCOUNT_ID'}
            type="button"
          >
            Sincronizar anúncios
          </button>
          <button
            className="chip"
            disabled={ocupado || !dados?.configurado.instagram}
            onClick={() => void sincronizar('instagram')}
            title={dados?.configurado.instagram ? '' : 'Defina META_PAGE_ID e META_PAGE_ACCESS_TOKEN'}
            type="button"
          >
            Importar Direct
          </button>
        </div>
      </header>

      {dados && !dados.configurado.anuncios && (
        <p className="hint">
          A conta de anúncios ainda não está ligada, então o gasto aparece zerado. Leads e reservas
          atribuídos por UTM e por click-to-WhatsApp já são contados.
        </p>
      )}
      {syncAnuncios && (
        <p className="hint">
          Última sincronização: {new Date(syncAnuncios.iniciado_em).toLocaleString('pt-BR')}
          {syncAnuncios.ok === false ? ' — falhou' : ''}.
        </p>
      )}

      <section className="stat-grid">
        <div className="stat-tile">
          <span className="stat-label">Investido</span>
          <strong className="stat-value">{brl(totais.gasto)}</strong>
          <small className="stat-hint">{inteiro(totais.cliques)} cliques</small>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Leads de anúncio</span>
          <strong className="stat-value">{inteiro(totais.leads)}</strong>
          <small className="stat-hint">CPL {custo(totais.gasto, totais.leads)}</small>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Reservas</span>
          <strong className="stat-value">{inteiro(totais.reservas)}</strong>
          <small className="stat-hint">
            {inteiro(totais.confirmadas)} confirmadas · {custo(totais.gasto, totais.confirmadas)} cada
          </small>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Recebido</span>
          <strong className="stat-value">{brl(totais.recebido)}</strong>
          <small className="stat-hint">ROAS {dados?.configurado.anuncios ? razao(totais.recebido, totais.gasto, (x) => `${x.toFixed(1)}×`) : '—'}</small>
        </div>
      </section>

      <section className="panel">
        <h2 className="sub">Por anúncio</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Anúncio</th>
                <th>Gasto</th>
                <th>Cliques</th>
                <th>Leads (Meta)</th>
                <th>Leads (site)</th>
                <th>Reservas</th>
                <th>Recebido</th>
                <th>Custo/reserva</th>
              </tr>
            </thead>
            <tbody>
              {dados?.anuncios.map((a) => (
                <tr key={a.ad_id}>
                  <td>
                    {a.ad_name ?? <span className="mono">#{a.ad_id}</span>}
                    <small>{[a.campaign_name, a.adset_name].filter(Boolean).join(' › ') || 'não sincronizado'}</small>
                  </td>
                  <td>{brl(a.spend)}</td>
                  <td>{inteiro(n(a.link_clicks) || n(a.clicks))}</td>
                  <td>
                    {inteiro(a.leads_meta)}
                    {n(a.conversas_meta) > 0 && <small>{inteiro(a.conversas_meta)} conversas</small>}
                  </td>
                  <td>{inteiro(a.leads)}</td>
                  <td>
                    {inteiro(a.reservas)}
                    {n(a.confirmadas) > 0 && <small>{inteiro(a.confirmadas)} confirmadas</small>}
                  </td>
                  <td>{brl(a.recebido)}</td>
                  <td>{custo(n(a.spend), n(a.confirmadas))}</td>
                </tr>
              ))}
              {dados && !dados.anuncios.length && (
                <tr>
                  <td colSpan={8} className="hint">
                    Nenhum anúncio com gasto ou lead no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="hint">
          &quot;Leads (Meta)&quot; é o que a Meta diz ter convertido; &quot;Leads (site)&quot; e reservas são
          contados aqui, pelo <code>ad_id</code>. A diferença entre os dois é normal — a Meta conta por
          modelo de atribuição dela.
        </p>
      </section>

      <div className="account-grid">
        <section className="panel">
          <h2 className="sub">Reservas atribuídas a anúncio</h2>
          {dados?.reservas.length ? (
            <ul className="attributed">
              {dados.reservas.map((r) => (
                <li key={r.id} style={{ borderLeftColor: r.unidade_cor ?? '#587276' }}>
                  <strong>{r.hospede}</strong>
                  <span>
                    {r.unidade} · {shortDate(r.check_in)} → {shortDate(r.check_out)} · {brl(r.total_amount)}
                  </span>
                  <span>
                    {STATUS_LABEL[r.status] ?? r.status} · {PAYMENT_LABEL[r.payment_status] ?? r.payment_status}
                  </span>
                  <em className="tag">
                    {r.ad_name ?? `Anúncio #${r.ad_id}`}
                    {r.campaign_name ? ` · ${r.campaign_name}` : ''}
                  </em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Nenhuma reserva do período veio de anúncio identificado.</p>
          )}
        </section>

        <section className="panel">
          <h2 className="sub">Leads por origem</h2>
          <table className="data-table">
            <tbody>
              {dados?.porCanal.map((c) => (
                <tr key={c.canal}>
                  <td>
                    {ORIGEM_CANAL[c.canal] ?? c.canal}
                    <span className="bar" style={{ width: `${(n(c.leads) / maxCanal) * 100}%` }} />
                  </td>
                  <td>{inteiro(c.leads)}</td>
                  <td>
                    <small>{inteiro(c.com_reserva)} com reserva</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="sub">Link dos anúncios</h2>
          <p className="hint">
            Em <em>Parâmetros de URL</em> do anúncio, cole o texto abaixo. A Meta troca os{' '}
            <code>{'{{...}}'}</code> pelos IDs reais e o site grava a origem de quem reservar.
          </p>
          <pre className="url-template">{URL_TEMPLATE}</pre>
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
