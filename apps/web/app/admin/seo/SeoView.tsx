'use client';

import { useState } from 'react';
import {
  descreverFiltros,
  linkGoogle,
  montarConsulta,
  type Aba,
  type BuscaPronta,
  type Filtros,
  type GrupoBuscas,
  type OpcoesBusca,
  type Periodo,
  type SafeSearch
} from '@/lib/buscaGoogle';

type Links = { site: string; sitemap: string; robots: string; aluguel: string; guia: string; pdf: string };
type Situacao = { dominioProprio: boolean; verificacaoGoogle: boolean; local: boolean };

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="chip"
      onClick={() => {
        void navigator.clipboard?.writeText(texto).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
      type="button"
    >
      {ok ? 'Copiado' : 'Copiar'}
    </button>
  );
}

function Consulta({ consulta, filtros }: { consulta: string; filtros: Filtros }) {
  return (
    <>
      <pre className="seo-query">
        <code>{consulta || '—'}</code>
      </pre>
      <ul className="seo-filtros">
        {descreverFiltros(filtros).map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <div className="row-actions">
        <Copiar texto={consulta} />
        <a
          aria-disabled={!consulta}
          className="button small"
          href={consulta ? linkGoogle(consulta, filtros) : undefined}
          rel="noreferrer"
          target="_blank"
        >
          Abrir no Google
        </a>
      </div>
    </>
  );
}

function CartaoBusca({ busca }: { busca: BuscaPronta }) {
  return (
    <article className="seo-busca">
      <h3>{busca.titulo}</h3>
      <p className="hint">{busca.objetivo}</p>
      <Consulta consulta={montarConsulta(busca.opcoes)} filtros={busca.filtros} />
    </article>
  );
}

const lista = (texto: string) =>
  texto
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Monta qualquer busca com os operadores, para pesquisas fora das prontas. */
function Montador({ host }: { host: string }) {
  const [f, setF] = useState({
    termos: 'flat para alugar',
    exatas: 'Praia dos Carneiros',
    alternativas: 'temporada, diária',
    excluir: 'venda',
    sites: '',
    tipoArquivo: '',
    noTitulo: '',
    naUrl: '',
    depoisDe: '',
    antesDe: '',
    aba: 'web' as Aba,
    periodo: 'qualquer' as Periodo,
    aoPeDaLetra: false,
    safe: 'padrao' as SafeSearch
  });
  const set = <K extends keyof typeof f>(campo: K, valor: (typeof f)[K]) => setF((atual) => ({ ...atual, [campo]: valor }));

  const opcoes: OpcoesBusca = {
    termos: f.termos,
    exatas: lista(f.exatas),
    alternativas: lista(f.alternativas),
    excluir: lista(f.excluir),
    sites: lista(f.sites),
    tipoArquivo: f.tipoArquivo,
    noTitulo: f.noTitulo,
    naUrl: f.naUrl,
    depoisDe: f.depoisDe,
    antesDe: f.antesDe
  };
  const filtros: Filtros = { aba: f.aba, periodo: f.periodo, aoPeDaLetra: f.aoPeDaLetra, safe: f.safe };

  return (
    <section className="panel" aria-labelledby="montador-titulo">
      <h2 id="montador-titulo">Montador de busca avançada</h2>
      <p className="hint">
        Preencha só o que precisar. Separe vários itens por vírgula. Domínios em &quot;Excluir&quot; viram
        <code> -site:</code>.
      </p>
      <div className="seo-form">
        <label>
          Palavras soltas
          <input onChange={(e) => set('termos', e.target.value)} value={f.termos} />
        </label>
        <label>
          Frase exata (&quot;aspas&quot;)
          <input onChange={(e) => set('exatas', e.target.value)} value={f.exatas} />
        </label>
        <label>
          Alternativas (OR)
          <input onChange={(e) => set('alternativas', e.target.value)} value={f.alternativas} />
        </label>
        <label>
          Excluir (-)
          <input onChange={(e) => set('excluir', e.target.value)} placeholder={`venda, ${host}`} value={f.excluir} />
        </label>
        <label>
          Só nestes sites (site:)
          <input onChange={(e) => set('sites', e.target.value)} placeholder="gov.br, airbnb.com.br" value={f.sites} />
        </label>
        <label>
          Tipo de arquivo (filetype:)
          <select onChange={(e) => set('tipoArquivo', e.target.value)} value={f.tipoArquivo}>
            <option value="">Qualquer</option>
            {['pdf', 'docx', 'xlsx', 'pptx', 'csv'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          No título (intitle:)
          <input onChange={(e) => set('noTitulo', e.target.value)} value={f.noTitulo} />
        </label>
        <label>
          Na URL (inurl:)
          <input onChange={(e) => set('naUrl', e.target.value)} value={f.naUrl} />
        </label>
        <label>
          Publicado depois de (after:)
          <input onChange={(e) => set('depoisDe', e.target.value)} type="date" value={f.depoisDe} />
        </label>
        <label>
          Publicado antes de (before:)
          <input onChange={(e) => set('antesDe', e.target.value)} type="date" value={f.antesDe} />
        </label>
        <label>
          Aba
          <select onChange={(e) => set('aba', e.target.value as Aba)} value={f.aba}>
            <option value="web">Web (Todas)</option>
            <option value="imagens">Imagens</option>
            <option value="noticias">Notícias</option>
            <option value="videos">Vídeos</option>
            <option value="shopping">Shopping</option>
          </select>
        </label>
        <label>
          Período (Ferramentas)
          <select onChange={(e) => set('periodo', e.target.value as Periodo)} value={f.periodo}>
            <option value="qualquer">Em qualquer data</option>
            <option value="dia">Últimas 24 horas</option>
            <option value="semana">Na última semana</option>
            <option value="mes">No último mês</option>
            <option value="ano">No último ano</option>
          </select>
        </label>
        <label>
          SafeSearch
          <select onChange={(e) => set('safe', e.target.value as SafeSearch)} value={f.safe}>
            <option value="padrao">Não mudar</option>
            <option value="filtrar">Filtrar</option>
            <option value="desativado">Desativado</option>
          </select>
        </label>
        <label className="check-inline">
          <input checked={f.aoPeDaLetra} onChange={(e) => set('aoPeDaLetra', e.target.checked)} type="checkbox" />
          Ao pé da letra
        </label>
      </div>
      <Consulta consulta={montarConsulta(opcoes)} filtros={filtros} />
    </section>
  );
}

export default function SeoView({
  grupos,
  host,
  links,
  situacao
}: {
  grupos: GrupoBuscas[];
  host: string;
  links: Links;
  situacao: Situacao;
}) {
  const itens: { ok: boolean; titulo: string; detalhe: React.ReactNode }[] = [
    {
      ok: !situacao.local,
      titulo: 'Endereço público',
      detalhe: situacao.dominioProprio
        ? `O Google indexa ${links.site} (definido em SITE_URL).`
        : situacao.local
          ? 'Rodando local: o Google só enxerga o site publicado.'
          : `Usando o endereço da Vercel (${host}). Com domínio próprio, defina SITE_URL e publique de novo.`
    },
    {
      ok: situacao.verificacaoGoogle,
      titulo: 'Google Search Console',
      detalhe: situacao.verificacaoGoogle
        ? 'Meta tag de verificação publicada. Envie o sitemap no Search Console.'
        : 'No Search Console, adicione o site como "Prefixo do URL", escolha "Tag HTML" e salve o código em GOOGLE_SITE_VERIFICATION na Vercel.'
    },
    {
      ok: true,
      titulo: 'Sitemap e robots',
      detalhe: (
        <>
          <a href={links.sitemap} rel="noreferrer" target="_blank">
            sitemap.xml
          </a>{' '}
          (páginas, fotos e vídeos) ·{' '}
          <a href={links.robots} rel="noreferrer" target="_blank">
            robots.txt
          </a>{' '}
          (painel e conta fora do índice)
        </>
      )
    },
    {
      ok: true,
      titulo: 'Páginas para busca',
      detalhe: (
        <>
          <a href={links.aluguel} rel="noreferrer" target="_blank">
            Flat e apartamento para alugar em Carneiros
          </a>{' '}
          · uma página por espaço ·{' '}
          <a href={links.guia} rel="noreferrer" target="_blank">
            Guia da praia
          </a>{' '}
          ·{' '}
          <a href={links.pdf} rel="noreferrer" target="_blank">
            Guia em PDF
          </a>
        </>
      )
    }
  ];

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">SEO</p>
          <h1>Como o Google vê o site.</h1>
        </div>
      </header>

      <section className="panel" aria-labelledby="situacao-titulo">
        <h2 id="situacao-titulo">Situação</h2>
        <ul className="seo-situacao">
          {itens.map((i) => (
            <li className={i.ok ? 'ok' : 'aviso'} key={i.titulo}>
              <strong>{i.titulo}</strong>
              <span>{i.detalhe}</span>
            </li>
          ))}
        </ul>
        <h3>O que só você pode fazer (fora do site)</h3>
        <ol className="seo-passos">
          <li>
            Search Console: confirme a verificação e envie <code>{links.sitemap}</code> em &quot;Sitemaps&quot;.
            Depois use &quot;Inspeção de URL&quot; › &quot;Solicitar indexação&quot; na página inicial e na de aluguel.
          </li>
          <li>
            Perfil da Empresa no Google (Google Maps): cadastre como hospedagem, com o link do site. É o que
            faz aparecer no mapa para &quot;flat em Carneiros&quot;.
          </li>
          <li>Coloque o link do site na bio do Instagram e nas respostas do WhatsApp.</li>
          <li>Peça avaliação no Google a cada hóspede depois do check-out.</li>
          <li>Domínio próprio (.com.br no Registro.br) dá mais confiança e clique do que o endereço da Vercel.</li>
        </ol>
      </section>

      {grupos.map((g) => (
        <section aria-label={g.titulo} className="panel" key={g.titulo}>
          <h2>{g.titulo}</h2>
          <p className="hint">{g.descricao}</p>
          <div className="seo-buscas">
            {g.buscas.map((b) => (
              <CartaoBusca busca={b} key={b.titulo} />
            ))}
          </div>
        </section>
      ))}

      <Montador host={host} />
    </>
  );
}
