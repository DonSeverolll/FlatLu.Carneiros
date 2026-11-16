/**
 * Endereço e nome públicos do site, usados em tudo que o Google lê: canonical,
 * sitemap, robots, Open Graph e dados estruturados.
 *
 * Ordem: `SITE_URL` (o domínio que você escolheu) → domínio de produção que a
 * Vercel expõe sozinha → localhost. Assim o site já sai indexável no
 * `.vercel.app` e passa para o domínio próprio só trocando `SITE_URL`.
 */
export const SITE_NAME = 'Apt Carneiros — Flat & Casa';
export const SITE_SHORT_NAME = 'Apt Carneiros';

export function siteUrl(): string {
  const configurado = process.env.SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const base = configurado || (vercel ? `https://${vercel}` : '') || 'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

export function absoluteUrl(path = '/'): string {
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Só o host (sem protocolo), para as buscas `site:` do painel. */
export function siteHost(): string {
  return siteUrl().replace(/^https?:\/\//, '');
}
