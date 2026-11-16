'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/api';
import { dateTime } from '@/lib/format';
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

type Links = { site: string; sitemap: string; robots: string; searchConsole: string };
type Situacao = { local: boolean; dominioProprio: boolean; verificacao: string | null; sitemapLidoEm: string | null };
type Pagina = {
  caminho: string;
  url: string;
  titulo: string;
  tipo: string;
  fotos: number;
  videos: number;
  ultimaVisitaGoogle: string | null;
  visitas30d: number;
};
type Passo = {
  id: string;
  titulo: string;
  como: string;
  feito: boolean;
  origem: 'manual' | 'automatico' | null;
  quando: string | null;
  quem: string | null;
  detalhe: string | null;
};

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

/** Passos fora do site, com marcação que fica salva (e registrada no Log). */
function Passos({ passos }: { passos: Passo[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const feitos = passos.filter((p) => p.feito).length;

  async function marcar(passo: Passo) {
    setOcupado(passo.id);
    setErro('');
    try {
      await api('/api/admin/seo/passos', {
        method: 'POST',
        body: { passo: passo.id, feito: !passo.feito }
      });
      router.refresh();
    } catch (e) {
      setErro(messageFor(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="panel" aria-labelledby="passos-titulo">
      <h2 id="passos-titulo">
        Passos no Google <small className="hint">({feitos} de {passos.length} feitos)</small>
      </h2>
      <p className="hint">O que só pode ser feito fora do site. Marque quando concluir: fica salvo e aparece no Log.</p>
      {erro && <p className="field-error">{erro}</p>}
      <ul className="seo-passos-lista">
        {passos.map((p) => (
          <li className={p.feito ? 'feito' : ''} key={p.id}>
            <span aria-hidden className="seo-passo-marca">
              {p.feito ? '✓' : ''}
            </span>
            <div>
              <strong>{p.titulo}</strong>
              <span className="hint">
                {p.feito
                  ? p.origem === 'manual'
                    ? `Marcado${p.quem ? ` por ${p.quem}` : ''}${p.quando ? ` em ${dateTime(p.quando)}` : ''}.`
                    : `${p.detalhe ?? 'Comprovado pelo site.'}${p.quando ? ` Última leitura: ${dateTime(p.quando)}.` : ''}`
                  : p.como}
              </span>
            </div>
            <button className="chip" disabled={ocupado === p.id} onClick={() => void marcar(p)} type="button">
              {ocupado === p.id ? '…' : p.feito ? 'Desmarcar' : 'Marcar como feito'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Paginas({ paginas, links }: { paginas: Pagina[]; links: Links }) {
  return (
    <section className="panel" aria-labelledby="paginas-titulo">
      <h2 id="paginas-titulo">Páginas do site no Google</h2>
      <p className="hint">
        As {paginas.length} páginas que estão no{' '}
        <a href={links.sitemap} rel="noreferrer" target="_blank">
          sitemap.xml
        </a>
        . A visita do Google é registrada quando o robô dele abre a página.
      </p>
      <div className="seo-tabela-scroll">
        <table className="data-table seo-tabela">
          <thead>
            <tr>
              <th>Página</th>
              <th>Fotos e vídeos</th>
              <th>Última visita do Google</th>
              <th>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paginas.map((p) => (
              <tr key={p.caminho}>
                <td>
                  <a href={p.url} rel="noreferrer" target="_blank">
                    {p.titulo}
                  </a>
                  <small>
                    {p.tipo} · {p.caminho}
                  </small>
                </td>
                <td>
                  {p.fotos} foto(s){p.videos ? ` · ${p.videos} vídeo(s)` : ''}
                </td>
                <td>
                  {p.ultimaVisitaGoogle ? (
                    <>
                      {dateTime(p.ultimaVisitaGoogle)}
                      <small>{p.visitas30d} visita(s) em 30 dias</small>
                    </>
                  ) : (
                    <span className="hint">Ainda não visitou</span>
                  )}
                </td>
                <td>
                  <a
                    className="link"
                    href={linkGoogle(`site:${p.url.replace(/^https?:\/\//, '')}`)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Está no Google?
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function SeoView({
  grupos,
  host,
  links,
  paginas,
  passos,
  situacao
}: {
  grupos: GrupoBuscas[];
  host: string;
  links: Links;
  paginas: Pagina[];
  passos: Passo[];
  situacao: Situacao;
}) {
  const itens: { ok: boolean; titulo: string; detalhe: React.ReactNode }[] = [
    {
      ok: !situacao.local,
      titulo: 'Endereço que o Google indexa',
      detalhe: situacao.local ? (
        'Rodando local: o Google só enxerga o site publicado.'
      ) : (
        <>
          <a href={links.site} rel="noreferrer" target="_blank">
            {host}
          </a>
          {situacao.dominioProprio ? ' (domínio próprio, via SITE_URL).' : ' (endereço da Vercel).'}
        </>
      )
    },
    {
      ok: Boolean(situacao.verificacao),
      titulo: 'Verificação do Search Console',
      detalhe: situacao.verificacao ? (
        <>
          Tag HTML publicada (código {situacao.verificacao}).{' '}
          <a href={links.searchConsole} rel="noreferrer" target="_blank">
            Abrir o Search Console
          </a>
        </>
      ) : (
        'Sem tag de verificação: defina GOOGLE_SITE_VERIFICATION na Vercel e publique de novo.'
      )
    },
    {
      ok: Boolean(situacao.sitemapLidoEm),
      titulo: 'Sitemap',
      detalhe: (
        <>
          <a href={links.sitemap} rel="noreferrer" target="_blank">
            sitemap.xml
          </a>{' '}
          com {paginas.length} páginas.{' '}
          {situacao.sitemapLidoEm
            ? `O Google leu pela última vez em ${dateTime(situacao.sitemapLidoEm)}.`
            : 'O robô do Google ainda não foi visto lendo o sitemap (pode levar alguns dias depois do envio).'}
        </>
      )
    },
    {
      ok: true,
      titulo: 'Robots',
      detalhe: (
        <>
          <a href={links.robots} rel="noreferrer" target="_blank">
            robots.txt
          </a>{' '}
          libera a vitrine e tira do índice o painel, a conta do hóspede, a API e o login.
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
      </section>

      <Passos passos={passos} />
      <Paginas links={links} paginas={paginas} />

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
