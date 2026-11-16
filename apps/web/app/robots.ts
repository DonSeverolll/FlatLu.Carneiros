import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** Vitrine aberta; painel, conta do hóspede e API ficam fora do índice. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api/', '/conta', '/reserva/', '/login', '/cadastro']
    },
    sitemap: absoluteUrl('/sitemap.xml')
  };
}
