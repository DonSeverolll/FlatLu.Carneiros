import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ConfigError } from '../config';

/**
 * Cifra dos segredos de integração (AES-256-GCM).
 *
 * Formato: `v1.<iv>.<tag>.<cifrado>` em base64url. O `v1` permite trocar de
 * algoritmo depois sem adivinhar o que está gravado. A chave de 32 bytes vem
 * de INTEGRATIONS_ENCRYPTION_KEY por SHA-256, então qualquer texto longo serve
 * (`openssl rand -base64 32`). Trocar a chave invalida o que foi gravado: os
 * segredos precisam ser digitados de novo no painel.
 */

const PREFIXO = 'v1';

export function chaveDeCifra(bruta = process.env.INTEGRATIONS_ENCRYPTION_KEY): Buffer {
  if (!bruta || bruta.length < 32) {
    throw new ConfigError(
      'INTEGRATIONS_ENCRYPTION_KEY ausente ou curta (mínimo 32 caracteres). Gere com: openssl rand -base64 32'
    );
  }
  return createHash('sha256').update(bruta, 'utf8').digest();
}

export function cifraDisponivel(): boolean {
  try {
    chaveDeCifra();
    return true;
  } catch {
    return false;
  }
}

/** @param contexto amarra o texto cifrado à integração (dado autenticado). */
export function cifrar(texto: string, contexto: string, chave = chaveDeCifra()): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  cifra.setAAD(Buffer.from(contexto, 'utf8'));
  const cifrado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  return [PREFIXO, iv, cifra.getAuthTag(), cifrado].map((p) =>
    typeof p === 'string' ? p : p.toString('base64url')
  ).join('.');
}

export function decifrar(pacote: string, contexto: string, chave = chaveDeCifra()): string {
  const [versao, iv, tag, cifrado] = pacote.split('.');
  if (versao !== PREFIXO || !iv || !tag || cifrado === undefined) {
    throw new Error('Formato de segredo desconhecido');
  }
  const decifra = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64url'));
  decifra.setAAD(Buffer.from(contexto, 'utf8'));
  decifra.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decifra.update(Buffer.from(cifrado, 'base64url')), decifra.final()]).toString('utf8');
}

/** "…a1b2" para a tela reconhecer o segredo sem vê-lo. */
export function finalDoSegredo(valor: string): string {
  return valor.length <= 8 ? '…' : `…${valor.slice(-4)}`;
}
