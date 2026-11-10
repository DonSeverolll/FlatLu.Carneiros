'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const PARAMETROS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'ad_id',
  'adset_id',
  'campaign_id'
] as const;

/**
 * Relata ao servidor os parâmetros de campanha com que o visitante chegou.
 *
 * Não grava nada no navegador: o vínculo é o cookie `httpOnly` que a API
 * devolve. Roda em qualquer página pública (a landing pode ser `/`, `/cadastro`
 * ou outra) e fica fora do painel.
 */
export default function AttributionCapture() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith('/admin')) return;
    const params = new URLSearchParams(window.location.search);
    const corpo: Record<string, string> = {};
    for (const nome of PARAMETROS) {
      const valor = params.get(nome);
      if (valor) corpo[nome] = valor;
    }
    if (!Object.keys(corpo).length) return;

    corpo.landing_path = pathname;
    if (document.referrer) corpo.referrer = document.referrer;

    void fetch('/api/attribution', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      keepalive: true
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}
