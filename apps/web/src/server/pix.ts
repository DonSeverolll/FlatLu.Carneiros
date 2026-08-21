/**
 * Gerador de BR Code Pix estático (EMV-QRCPS-MPM, padrão Banco Central).
 *
 * Permite cobrar o sinal sem contratar adquirente: o hóspede recebe um
 * "copia e cola" com valor e identificador fixos, e a conciliação acontece pelo
 * identificador. Quando houver provedor (Mercado Pago, Stripe, Asaas), o mesmo
 * fluxo continua valendo — só troca o `provider` do pagamento.
 */

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** CRC16/CCITT-FALSE — polinômio 0x1021, valor inicial 0xFFFF. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** O padrão aceita apenas ASCII maiúsculo em nome e cidade. */
function sanitize(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, maxLength);
}

export function buildPixPayload(input: {
  key: string;
  merchantName: string;
  merchantCity?: string;
  amountCents: number;
  reference: string;
}): string {
  if (!input.key.trim()) throw new Error('PIX_KEY_REQUIRED');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('PIX_AMOUNT_INVALID');
  }

  const reference = sanitize(input.reference, 25).replace(/ /g, '') || '***';

  const payload = [
    tlv('00', '01'),
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', input.key.trim())),
    tlv('52', '0000'),
    tlv('53', '986'),
    tlv('54', (input.amountCents / 100).toFixed(2)),
    tlv('58', 'BR'),
    tlv('59', sanitize(input.merchantName, 25) || 'RECEBEDOR'),
    tlv('60', sanitize(input.merchantCity ?? 'TAMANDARE', 15) || 'BRASIL'),
    tlv('62', tlv('05', reference))
  ].join('');

  const withCrcMarker = `${payload}6304`;
  return `${withCrcMarker}${crc16(withCrcMarker)}`;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código curto, legível ao telefone, sem caracteres ambíguos (0/O, 1/I). */
export function paymentReference(random: () => number = Math.random): string {
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return `CARN${code}`;
}
