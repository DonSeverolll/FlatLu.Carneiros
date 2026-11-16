import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '../../JsonLd';
import { SiteFooter, SiteNav, Trilha } from '../../SiteChrome';
import { longDate } from '@/lib/format';
import {
  CONTEUDO_ATUALIZADO_EM,
  GUIA,
  GUIA_RESUMO,
  GUIA_TITULO,
  PAGINA_ALUGUEL,
  PAGINA_GUIA,
  PDF_GUIA,
  caminhoDoEspaco,
  tituloDoEspaco
} from '@/server/seo/conteudo';
import { jsonLdGuia, jsonLdTrilha } from '@/server/seo/jsonld';
import { carregarCalendario } from '@/server/seo/vitrine';
import { registrarVisitaDoGoogle } from '@/server/seo/painel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: GUIA_TITULO,
  description: GUIA_RESUMO,
  alternates: { canonical: PAGINA_GUIA },
  openGraph: {
    title: GUIA_TITULO,
    description: GUIA_RESUMO,
    url: PAGINA_GUIA,
    type: 'article',
    locale: 'pt_BR',
    publishedTime: CONTEUDO_ATUALIZADO_EM,
    modifiedTime: CONTEUDO_ATUALIZADO_EM
  }
};

export default async function GuiaPage() {
  const [{ calendar }] = await Promise.all([carregarCalendario(), registrarVisitaDoGoogle(PAGINA_GUIA)]);
  const units = calendar?.units ?? [];
  const trilha = [
    { nome: 'Início', caminho: '/' },
    { nome: 'Guia da Praia dos Carneiros', caminho: PAGINA_GUIA }
  ];

  return (
    <main>
      <JsonLd data={[jsonLdGuia(PAGINA_GUIA, PDF_GUIA), jsonLdTrilha(trilha)]} />
      <SiteNav />
      <article className="seo-page guia">
        <Trilha itens={[trilha[0]!, { nome: trilha[1]!.nome }]} />
        <p className="eyebrow">Guia da região</p>
        <h1>{GUIA_TITULO}</h1>
        <p className="lead">{GUIA_RESUMO}</p>
        <p className="hint">
          Atualizado em <time dateTime={CONTEUDO_ATUALIZADO_EM}>{longDate(CONTEUDO_ATUALIZADO_EM)}</time> ·{' '}
          <a href={PDF_GUIA}>Baixar em PDF</a>
        </p>

        <nav aria-label="Neste guia" className="guia-indice">
          <ol>
            {GUIA.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.titulo}</a>
              </li>
            ))}
          </ol>
        </nav>

        {GUIA.map((s) => (
          <section aria-labelledby={s.id} key={s.id}>
            <h2 id={s.id}>{s.titulo}</h2>
            {s.paragrafos.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>
        ))}

        {units.length > 0 && (
          <section aria-labelledby="hospedagem">
            <h2 id="hospedagem">Hospedagem com calendário aberto</h2>
            <ul>
              {units.map((u) => (
                <li key={u.slug}>
                  <Link href={caminhoDoEspaco(u.slug)}>{tituloDoEspaco(u)}</Link> — até {u.maxGuests} pessoas
                </li>
              ))}
            </ul>
            <Link className="button" href={PAGINA_ALUGUEL}>
              Ver todos os espaços e datas
            </Link>
          </section>
        )}
      </article>
      <SiteFooter espacos={units} />
    </main>
  );
}
