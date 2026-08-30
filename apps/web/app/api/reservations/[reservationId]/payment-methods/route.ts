import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { query } from '@/server/db';
import { notFound } from '@/server/errors';
import { handle, json } from '@/server/http';
import { CARD_PROVIDER, cardProviderConfigured } from '@/server/paymentProvider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const params = z.object({ reservationId: z.string().uuid() });

/**
 * Quais formas de pagamento esta reserva aceita de fato.
 *
 * Existe para a tela não oferecer um botão que sempre falha: Pix depende da
 * chave do espaço, cartão depende da credencial do provedor. Melhor dizer
 * antes do clique do que devolver erro depois.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ reservationId: string }> }) {
  return handle(async () => {
    const session = await requireUser();
    const { reservationId } = params.parse(await ctx.params);

    const result = await query<{ pix_configured: boolean }>(
      `SELECT p.pix_key IS NOT NULL AS pix_configured
       FROM reservations r JOIN properties p ON p.id = r.property_id
       WHERE r.id = $1 AND r.customer_id = $2`,
      [reservationId, session.id]
    );
    if (!result.rowCount) throw notFound('RESERVATION_NOT_FOUND');

    return json({
      pix: Boolean(result.rows[0]!.pix_configured),
      card: cardProviderConfigured(),
      cardProvider: CARD_PROVIDER
    });
  });
}
