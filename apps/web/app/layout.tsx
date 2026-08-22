import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Apt Carneiros — Flat & Casa',
  description:
    'Flat na Praia de Carneiros e os dois andares da casa em São José da Coroa Grande. Disponibilidade real e sinal por Pix.',
  openGraph: {
    title: 'Apt Carneiros — Flat & Casa',
    description: 'Três espaços independentes no litoral sul de Pernambuco.',
    locale: 'pt_BR',
    type: 'website'
  },
  robots: { index: true, follow: true }
};

export const viewport: Viewport = {
  themeColor: '#173f45',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
