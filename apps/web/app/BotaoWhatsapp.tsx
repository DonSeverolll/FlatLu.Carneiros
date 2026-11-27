'use client';

import { usePathname } from 'next/navigation';
import { LOGOS_MARCAS } from '@/lib/logosMarcas';

const ICONE = LOGOS_MARCAS.find((l) => l.nome === 'WhatsApp')!.d;

/**
 * Botão flutuante que abre a conversa com o dono no WhatsApp do próprio
 * cliente (app no celular, WhatsApp Web no computador), com uma mensagem
 * pronta. Não aparece no painel nem sem número configurado.
 */
export default function BotaoWhatsapp({ numero }: { numero: string | null }) {
  const caminho = usePathname();
  if (!numero || caminho.startsWith('/admin')) return null;
  const texto = 'Olá! Vim pelo site Apt Carneiros e quero saber sobre disponibilidade.';
  return (
    <a
      aria-label="Fale conosco no WhatsApp"
      className="botao-whatsapp"
      href={`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`}
      rel="noreferrer"
      target="_blank"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d={ICONE} fill="currentColor" />
      </svg>
      <span>Fale conosco</span>
    </a>
  );
}
