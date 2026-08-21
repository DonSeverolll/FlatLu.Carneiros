import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * `pg` e `@node-rs/argon2` carregam binário nativo/`require` dinâmico. Sem
   * marcá-los como externos, o bundler do Next tenta empacotá-los e a função
   * quebra em runtime no Vercel.
   */
  serverExternalPackages: ['pg', '@node-rs/argon2'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          }
        ]
      },
      { source: '/api/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] }
    ];
  }
};

export default nextConfig;
