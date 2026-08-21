import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Flat Praia de Carneiros',
  description: 'Reserve sua estadia na Praia de Carneiros.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
