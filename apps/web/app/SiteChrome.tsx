import Link from 'next/link';
import { PAGINA_ALUGUEL, PAGINA_GUIA, PDF_GUIA, caminhoDoEspaco } from '@/server/seo/conteudo';

type EspacoLink = { slug: string; shortName: string };

/** Topo das páginas públicas. O nome leva para a vitrine. */
export function SiteNav({ fotos = false }: { fotos?: boolean }) {
  return (
    <nav className="nav">
      <Link className="nav-brand" href="/">
        APT CARNEIROS · FLAT &amp; CASA
      </Link>
      <span className="nav-links">
        {fotos && <a href="#espacos">Fotos</a>}
        <Link href={PAGINA_GUIA}>Guia da praia</Link>
        <a href="#reserva">Consultar datas</a>
      </span>
    </nav>
  );
}

/**
 * Rodapé com os links internos: além de ajudar o hóspede, é por eles que o
 * robô do Google chega a todas as páginas a partir de qualquer uma.
 */
export function SiteFooter({ espacos }: { espacos: EspacoLink[] }) {
  return (
    <footer className="site-footer site-footer-seo">
      <div>
        <strong>Apt Carneiros</strong>
        <span>Aluguel de temporada na Praia dos Carneiros e em São José da Coroa Grande — PE</span>
      </div>
      <ul aria-label="Espaços">
        {espacos.map((e) => (
          <li key={e.slug}>
            <Link href={caminhoDoEspaco(e.slug)}>{e.shortName}</Link>
          </li>
        ))}
      </ul>
      <ul aria-label="Mais">
        <li>
          <Link href={PAGINA_ALUGUEL}>Flat e apartamento para alugar em Carneiros</Link>
        </li>
        <li>
          <Link href={PAGINA_GUIA}>Guia da Praia dos Carneiros</Link>
        </li>
        <li>
          <a href={PDF_GUIA}>Guia em PDF</a>
        </li>
        <li>
          <Link href="/login">Área do hóspede</Link>
        </li>
      </ul>
    </footer>
  );
}

export function Trilha({ itens }: { itens: { nome: string; caminho?: string }[] }) {
  return (
    <nav aria-label="Você está em" className="trilha">
      {itens.map((item, i) => (
        <span key={item.nome}>
          {i > 0 && ' › '}
          {item.caminho ? <Link href={item.caminho}>{item.nome}</Link> : <span aria-current="page">{item.nome}</span>}
        </span>
      ))}
    </nav>
  );
}

/** Perguntas frequentes em <details>: abre sem JavaScript e o texto fica no HTML. */
export function Perguntas({ perguntas }: { perguntas: { pergunta: string; resposta: string }[] }) {
  if (!perguntas.length) return null;
  return (
    <section className="faq" aria-labelledby="faq-titulo" id="perguntas">
      <p className="eyebrow">Dúvidas</p>
      <h2 id="faq-titulo">Perguntas frequentes</h2>
      {perguntas.map((p) => (
        <details key={p.pergunta}>
          <summary>{p.pergunta}</summary>
          <p>{p.resposta}</p>
        </details>
      ))}
    </section>
  );
}
