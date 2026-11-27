/**
 * Número de WhatsApp no formato do link wa.me: só dígitos, com DDI.
 * "(81) 99999-9999" → "5581999999999"; número já com DDI fica como está.
 */
export function numeroWhatsapp(bruto: string | undefined | null): string | null {
  const digitos = (bruto ?? '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if (digitos.length >= 12 && digitos.length <= 15) return digitos;
  return null;
}
