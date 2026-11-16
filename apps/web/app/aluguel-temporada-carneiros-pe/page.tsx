import type { Metadata } from 'next';
import Link from 'next/link';
import BookingWidget from '../BookingWidget';
import JsonLd from '../JsonLd';
import { Perguntas, SiteFooter, SiteNav, Trilha } from '../SiteChrome';
import {
  PAGINA_ALUGUEL,
  PAGINA_GUIA,
  PDF_GUIA,
  caminhoDoEspaco,
  perguntasFrequentes,
  precoAPartirDe,
  tituloDoEspaco
} from '@/server/seo/conteudo';
import { jsonLdLista, jsonLdPerguntas, jsonLdTrilha } from '@/server/seo/jsonld';
import { carregarVitrine, fotosDoEspaco } from '@/server/seo/vitrine';

export const dynamic = 'force-dynamic';

const TITULO = 'Flat e apartamento para alugar em Carneiros – PE';
const DESCRICAO =
  'Flat para alugar na Praia dos Carneiros (Tamandaré) e casa de temporada em São José da Coroa Grande, PE. Veja fotos, preço por noite e datas livres e reserve online com sinal por Pix.';

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRICAO,
  alternates: { canonical: PAGINA_ALUGUEL },
  openGraph: { title: TITULO, description: DESCRICAO, url: PAGINA_ALUGUEL, type: 'website', locale: 'pt_BR' }
};

/**
 * Página de entrada para quem busca "flat / apartamento para alugar em
 * Carneiros". Reúne os espaços com preço e capacidade, explica a reserva e
 * responde as dúvidas — conteúdo próprio, não uma cópia da vitrine.
 */
export default async function AluguelCarneirosPage() {
  const { calendar, catalogo } = await carregarVitrine();
  const units = calendar?.units ?? [];
  const perguntas = perguntasFrequentes(units);
  const trilha = [
    { nome: 'Início', caminho: '/' },
    { nome: 'Aluguel de temporada em Carneiros', caminho: PAGINA_ALUGUEL }
  ];

  return (
    <main>
      <JsonLd data={[jsonLdLista(units), jsonLdTrilha(trilha), jsonLdPerguntas(perguntas)].filter(Boolean)} />
      <SiteNav />

      <section className="seo-page">
        <Trilha itens={[trilha[0]!, { nome: trilha[1]!.nome }]} />
        <p className="eyebrow">Aluguel de temporada · Litoral sul de Pernambuco</p>
        <h1>{TITULO}</h1>
        <p className="lead">
          Procurando flat ou apartamento para alugar na Praia dos Carneiros? Aqui você vê os espaços
          com a disponibilidade real, o preço por noite e reserva direto com o anfitrião, sem
          intermediário.
        </p>
      </section>

      <section className="seo-page">
        <h2>Espaços para alugar</h2>
        {units.length ? (
          <div className="seo-cards">
            {units.map((u) => {
              const capa = fotosDoEspaco(catalogo, u.slug).find((f) => f.tipo === 'IMAGE');
              const preco = precoAPartirDe(u);
              return (
                <article className="seo-card" key={u.slug}>
                  {capa && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={capa.descricao ?? `${u.shortName} para alugar — ${u.locationName ?? 'Carneiros, PE'}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      src={capa.miniatura}
                    />
                  )}
                  <h3>
                    <Link href={caminhoDoEspaco(u.slug)}>{tituloDoEspaco(u)}</Link>
                  </h3>
                  <p>{u.description}</p>
                  <p className="hint">
                    Até {u.maxGuests} pessoas{preco ? ` · a partir de ${preco} por noite` : ''}
                  </p>
                  <Link className="link" href={caminhoDoEspaco(u.slug)}>
                    Ver fotos e datas livres
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="hint">Os espaços voltam a aparecer aqui em instantes.</p>
        )}
      </section>

      <section className="seo-page">
        <h2>Por que alugar direto</h2>
        <ul className="seo-lista">
          <li>Calendário de verdade: a data que aparece livre está livre.</li>
          <li>Preço total na hora, antes de reservar — sem taxa surpresa no fim.</li>
          <li>Reserva garantida com sinal por Pix e acompanhamento na Área do hóspede.</li>
          <li>Cada espaço é independente, com entrada própria: alugue um ou junte a turma.</li>
        </ul>
        <p>
          Primeira vez na região? O <Link href={PAGINA_GUIA}>guia da Praia dos Carneiros</Link> explica
          maré, passeios e dicas (também em <a href={PDF_GUIA}>PDF para baixar</a>).
        </p>
      </section>

      {calendar && (
        <section className="booking-section" id="reserva">
          <BookingWidget calendar={calendar} />
        </section>
      )}

      <Perguntas perguntas={perguntas} />
      <SiteFooter espacos={units} />
    </main>
  );
}
