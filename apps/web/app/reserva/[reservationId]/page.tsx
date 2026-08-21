'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, messageFor } from '@/lib/api';
import { brl, longDate } from '@/lib/format';
import type { PaymentIntentDto } from '@/lib/types';

/**
 * Página de pagamento do sinal.
 *
 * Era o passo inexistente: a reserva nascia PENDING_PAYMENT e não havia
 * nenhuma forma de pagar. A cobrança é idempotente no servidor, então recarregar
 * esta página devolve sempre o mesmo Pix e a mesma referência.
 */
export default function PaymentPage({ params }: { params: Promise<{ reservationId: string }> }) {
  const { reservationId } = use(params);
  const [intent, setIntent] = useState<PaymentIntentDto | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<PaymentIntentDto>(`/api/reservations/${reservationId}/payment-intent`, { method: 'POST' })
      .then((data) => {
        if (active) setIntent(data);
      })
      .catch((cause) => {
        if (active) setError(messageFor(cause));
      });
    return () => {
      active = false;
    };
  }, [reservationId]);

  // Contagem regressiva do hold: o hóspede precisa ver quanto tempo tem.
  useEffect(() => {
    if (!intent) return;
    const deadline = new Date(intent.reservation.holdExpiresAt).getTime();
    const tick = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) {
        setRemaining('expirado');
        return;
      }
      const minutes = Math.floor(diff / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1000);
      setRemaining(
        minutes >= 60
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}min`
          : `${minutes}min ${String(seconds).padStart(2, '0')}s`
      );
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [intent]);

  async function copyPayload() {
    if (!intent) return;
    try {
      await navigator.clipboard.writeText(intent.pix.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Não foi possível copiar. Selecione o código manualmente.');
    }
  }

  if (error && !intent) {
    return (
      <main className="account">
        <Link className="back-link" href="/">
          ← Voltar
        </Link>
        <p className="feedback">{error}</p>
        <Link className="button" href="/conta">
          Ver minhas reservas
        </Link>
      </main>
    );
  }

  if (!intent) {
    return (
      <main className="account">
        <p>Gerando sua cobrança...</p>
      </main>
    );
  }

  return (
    <main className="account payment-page">
      <Link className="back-link" href="/conta">
        ← Minhas reservas
      </Link>
      <p className="eyebrow">Pagamento do sinal</p>
      <h1>Falta pouco para confirmar.</h1>

      <div className="account-grid">
        <section className="panel">
          <h2>Pix</h2>
          <div className="qr-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="QR Code do Pix para pagamento do sinal"
              src={`/api/reservations/${reservationId}/pix-qr`}
              width={220}
              height={220}
            />
          </div>
          <p className="pix-amount">{brl(intent.reservation.depositAmount)}</p>
          <label>
            Copia e cola
            <textarea readOnly rows={4} value={intent.pix.payload} />
          </label>
          <button className="button" type="button" onClick={() => void copyPayload()}>
            {copied ? 'Código copiado' : 'Copiar código Pix'}
          </button>
          <dl className="facts">
            <div>
              <dt>Favorecido</dt>
              <dd>{intent.pix.holderName}</dd>
            </div>
            <div>
              <dt>Identificador</dt>
              <dd>{intent.payment.reference}</dd>
            </div>
          </dl>
          {intent.pix.instructions && <p className="hint">{intent.pix.instructions}</p>}
        </section>

        <section className="panel">
          <h2>Sua reserva</h2>
          <dl className="facts stacked">
            <div>
              <dt>Entrada</dt>
              <dd>{longDate(intent.reservation.checkIn)}</dd>
            </div>
            <div>
              <dt>Saída</dt>
              <dd>{longDate(intent.reservation.checkOut)}</dd>
            </div>
            <div>
              <dt>Total da estadia</dt>
              <dd>{brl(intent.reservation.totalAmount)}</dd>
            </div>
            <div>
              <dt>Sinal agora</dt>
              <dd>{brl(intent.reservation.depositAmount)}</dd>
            </div>
            <div>
              <dt>Restante</dt>
              <dd>
                {brl(
                  Number(intent.reservation.totalAmount) - Number(intent.reservation.depositAmount)
                )}
              </dd>
            </div>
          </dl>
          <p className={remaining === 'expirado' ? 'feedback' : 'hint'}>
            {remaining === 'expirado'
              ? 'O prazo para pagamento venceu. Consulte as datas novamente.'
              : `Datas seguras por ${remaining}.`}
          </p>
          <p className="hint">
            Depois de pagar, a confirmação aparece aqui e na sua conta. Guarde o identificador{' '}
            <strong>{intent.payment.reference}</strong> — ele é a referência da conciliação.
          </p>
        </section>
      </div>
      {error && <p className="feedback">{error}</p>}
    </main>
  );
}
