import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Flat Praia de Carneiros',
  description: 'Reserve sua estadia na Praia de Carneiros: disponibilidade real e sinal por Pix.',
  openGraph: {
    title: 'Flat Praia de Carneiros',
    description: 'Reserve sua estadia na Praia de Carneiros.',
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
