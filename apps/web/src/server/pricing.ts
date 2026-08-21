/**
 * Cálculo de valores em centavos inteiros. Multiplicar float por noites e
 * arredondar no fim produz divergência de centavos entre o que o front mostra
 * e o que o banco grava — aqui não há float no meio do caminho.
 */

export type Quote = {
  nights: number;
  nightlyRateCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
};

function toCents(numeric: string | number): number {
  const cents = Math.round(Number(numeric) * 100);
  if (!Number.isFinite(cents) || cents < 0) throw new Error('INVALID_MONETARY_VALUE');
  return cents;
}

export function quote(input: {
  nightlyRate: string | number;
  depositPercentage: string | number;
  nights: number;
}): Quote {
  const { nights } = input;
  if (!Number.isInteger(nights) || nights <= 0) throw new Error('INVALID_NIGHTS');

  const nightlyRateCents = toCents(input.nightlyRate);
  const totalCents = nightlyRateCents * nights;

  const percentage = Number(input.depositPercentage);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('INVALID_DEPOSIT_PERCENTAGE');
  }
  const depositCents = Math.round((totalCents * percentage) / 100);

  return {
    nights,
    nightlyRateCents,
    totalCents,
    depositCents,
    balanceCents: totalCents - depositCents
  };
}

/** Valor em reais com 2 casas, pronto para uma coluna NUMERIC(12,2). */
export function centsToNumeric(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
