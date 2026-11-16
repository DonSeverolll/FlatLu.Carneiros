/**
 * Dados estruturados na página. O `<` vira \u003c para um texto vindo do banco
 * (descrição de foto, por exemplo) nunca fechar a tag script.
 */
export default function JsonLd({ data }: { data: unknown }) {
  if (!data || (Array.isArray(data) && !data.length)) return null;
  return (
    <script
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\u003c') }}
      type="application/ld+json"
    />
  );
}
