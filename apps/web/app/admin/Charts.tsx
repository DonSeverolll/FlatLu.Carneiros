'use client';

import { useMemo, useState } from 'react';

/**
 * Gráficos do painel, em SVG inline.
 *
 * Decisões que valem registro:
 *
 *  * Cada gráfico tem UMA série. Duas medidas de escalas diferentes (dinheiro e
 *    contagem) nunca dividem um eixo — viram gráficos separados. Eixo duplo é o
 *    engano mais comum em painel.
 *  * As cores das unidades (#1F3A5F, #2E6F4E, #E76F51) reprovaram como paleta
 *    categórica de gráfico: escuras e dessaturadas demais. Onde a comparação é
 *    entre unidades, a forma é tabela com barra — a identidade fica no rótulo e
 *    a cor só reforça.
 *  * Rótulo direto é seletivo: o maior valor e o último. Número em cima de todo
 *    ponto vira ruído.
 */

export type SeriePonto = { periodo: string; valor: number };

const EIXO = 'rgba(23,63,69,.18)';

function formatarEixo(valor: number, moeda: boolean): string {
  if (!moeda) return String(valor);
  if (valor >= 1000) return `${Math.round(valor / 1000)}k`;
  return String(Math.round(valor));
}

function rotuloPeriodo(iso: string, granularidade: string): string {
  const [ano, mes, dia] = iso.split('-');
  if (granularidade === 'month') return `${mes}/${ano?.slice(2)}`;
  return `${dia}/${mes}`;
}

export function BarChart({
  data,
  color,
  label,
  currency = false,
  granularity = 'day',
  height = 180
}: {
  data: SeriePonto[];
  color: string;
  label: string;
  currency?: boolean;
  granularity?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const { maximo, indiceMaior } = useMemo(() => {
    let maximo = 0;
    let indiceMaior = -1;
    data.forEach((ponto, indice) => {
      if (ponto.valor > maximo) {
        maximo = ponto.valor;
        indiceMaior = indice;
      }
    });
    return { maximo, indiceMaior };
  }, [data]);

  if (!data.length) return <p className="hint">Sem dados no período.</p>;
  if (maximo === 0) {
    return <p className="hint">Nenhum valor registrado em {label.toLowerCase()} no período.</p>;
  }

  const largura = 720;
  const margemEsquerda = 44;
  const margemBaixo = 22;
  const areaLargura = largura - margemEsquerda - 8;
  const areaAltura = height - margemBaixo - 10;
  const passo = areaLargura / data.length;
  // 2px de respiro entre barras vizinhas; marca fina, nunca bloco colado.
  const larguraBarra = Math.max(2, Math.min(passo - 2, 26));

  const ponto = hover === null ? null : data[hover];

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${largura} ${height}`}
        role="img"
        aria-label={`${label} por período`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Grade recessiva: três linhas, sem competir com as barras. */}
        {[0, 0.5, 1].map((fracao) => {
          const y = 10 + areaAltura * (1 - fracao);
          return (
            <g key={fracao}>
              <line x1={margemEsquerda} x2={largura - 8} y1={y} y2={y} stroke={EIXO} strokeWidth={1} />
              <text className="chart-axis" x={margemEsquerda - 8} y={y + 4} textAnchor="end">
                {formatarEixo(maximo * fracao, currency)}
              </text>
            </g>
          );
        })}

        {data.map((item, indice) => {
          const altura = maximo ? (item.valor / maximo) * areaAltura : 0;
          const x = margemEsquerda + indice * passo + (passo - larguraBarra) / 2;
          const y = 10 + areaAltura - altura;
          const destacado = hover === indice;
          return (
            <g key={item.periodo}>
              {/* Alvo de clique maior que a marca, para o hover não escapar. */}
              <rect
                x={margemEsquerda + indice * passo}
                y={10}
                width={passo}
                height={areaAltura}
                fill="transparent"
                onMouseEnter={() => setHover(indice)}
              />
              {altura > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={larguraBarra}
                  height={altura}
                  rx={Math.min(4, larguraBarra / 2)}
                  fill={color}
                  opacity={hover === null || destacado ? 1 : 0.45}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* Rótulo direto só no maior valor. */}
        {indiceMaior >= 0 && (
          <text
            className="chart-value"
            x={margemEsquerda + indiceMaior * passo + passo / 2}
            y={10 + areaAltura - (data[indiceMaior]!.valor / maximo) * areaAltura - 6}
            textAnchor="middle"
          >
            {currency ? formatarEixo(maximo, true) : maximo}
          </text>
        )}

        <line
          x1={margemEsquerda}
          x2={largura - 8}
          y1={10 + areaAltura}
          y2={10 + areaAltura}
          stroke={EIXO}
          strokeWidth={1}
        />

        {/* No máximo 8 marcas no eixo, para não empilhar texto. */}
        {data.map((item, indice) => {
          const intervalo = Math.max(1, Math.ceil(data.length / 8));
          if (indice % intervalo !== 0) return null;
          return (
            <text
              className="chart-axis"
              key={item.periodo}
              x={margemEsquerda + indice * passo + passo / 2}
              y={height - 6}
              textAnchor="middle"
            >
              {rotuloPeriodo(item.periodo, granularity)}
            </text>
          );
        })}
      </svg>

      <figcaption className="chart-caption">
        {ponto ? (
          <>
            <strong>{rotuloPeriodo(ponto.periodo, granularity)}</strong>{' '}
            {currency
              ? ponto.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
              : `${ponto.valor} ${label.toLowerCase()}`}
          </>
        ) : (
          <>Passe o mouse para ver cada período.</>
        )}
      </figcaption>
    </figure>
  );
}

/** Barra em linha de tabela: a identidade vem do rótulo, a cor só reforça. */
export function Meter({
  value,
  max,
  color,
  title
}: {
  value: number;
  max: number;
  color: string;
  title?: string;
}) {
  const percentual = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className="meter" title={title}>
      <span className="meter-fill" style={{ width: `${percentual}%`, background: color }} />
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className={tone ? `stat-tile ${tone}` : 'stat-tile'}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <small className="stat-hint">{hint}</small>}
    </div>
  );
}
