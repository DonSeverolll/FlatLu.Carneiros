import type { MetadataRoute } from 'next';
import { paginasDoSite, paraSitemap } from '@/server/seo/paginas';
import { registrarVisitaDoGoogle } from '@/server/seo/painel';

// Lê o banco a cada pedido: espaço novo ou foto aprovada entram no sitemap
// sem precisar de deploy. Sem lastModified nas páginas vivas — data "de agora"
// a cada visita ensina o Google a ignorar o campo; só o guia, que tem data de
// revisão real, informa.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await registrarVisitaDoGoogle('/sitemap.xml');
  return paraSitemap(await paginasDoSite());
}
