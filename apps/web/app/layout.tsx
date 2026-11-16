import type { Metadata, Viewport } from 'next';
import AttributionCapture from './AttributionCapture';
import GuestSidebar from './GuestSidebar';
import { SITE_NAME, SITE_SHORT_NAME, siteUrl } from '@/lib/site';
import { PALAVRAS_CHAVE } from '@/server/seo/conteudo';
import './globals.css';

/**
 * Metadados de base. Cada página pública define título, descrição e canonical
 * próprios; aqui ficam o domínio (para URLs absolutas), o modelo de título e a
 * verificação do Google Search Console.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  applicationName: SITE_NAME,
  title: {
    default: 'Flat para alugar em Carneiros PE — Apt Carneiros',
    template: `%s | ${SITE_SHORT_NAME}`
  },
  description:
    'Flat para alugar na Praia dos Carneiros (Tamandaré) e casa de temporada em São José da Coroa Grande, PE. Disponibilidade real e reserva com sinal por Pix.',
  keywords: PALAVRAS_CHAVE,
  openGraph: {
    siteName: SITE_NAME,
    title: 'Flat para alugar em Carneiros PE — Apt Carneiros',
    description: 'Três espaços independentes para temporada no litoral sul de Pernambuco.',
    locale: 'pt_BR',
    type: 'website'
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true, 'max-image-preview': 'large' },
  ...(process.env.GOOGLE_SITE_VERIFICATION?.trim()
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION.trim() } }
    : {}),
  formatDetection: { telephone: false }
};

export const viewport: Viewport = {
  themeColor: '#173f45',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <AttributionCapture />
        {/* Acesso do hóspede em qualquer página; some no painel. */}
        <GuestSidebar />
      </body>
    </html>
  );
}
