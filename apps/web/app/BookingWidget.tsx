'use client';

import { useEffect, useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SLUG = 'flat-praia-de-carneiros';

type Property = { id: string; name: string; nightly_rate: string; deposit_percentage: string; terms_version: string; terms_content: string };
type Block = { starts_at: string; ends_at: string };

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

export default function BookingWidget() {
  const [property, setProperty] = useState<Property | null>(null);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [status, setStatus] = useState('');

  const dates = useMemo(() => Array.from({ length: 120 }, (_, index) => addDays(new Date(), index)), []);

  useEffect(() => {
    async function loadAvailability() {
      try {
        const propertyResponse = await fetch(`${API_URL}/properties/${SLUG}`);
        if (!propertyResponse.ok) return setStatus('Banco de dados indisponível. Tente novamente em instantes.');
        const propertyData = await propertyResponse.json();
        setProperty(propertyData.property);
        const from = dateKey(dates[0]);
        const to = dateKey(addDays(dates[dates.length - 1], 1));
        const availabilityResponse = await fetch(`${API_URL}/properties/${propertyData.property.id}/availability?from=${from}&to=${to}`);
        if (!availabilityResponse.ok) return setStatus('Não foi possível consultar as datas.');
        const availability = await availabilityResponse.json();
        const unavailable = new Set<string>();
        for (const block of availability.blocked as Block[]) {
          const start = new Date(block.starts_at);
          const end = new Date(block.ends_at);
          for (let day = new Date(start); day < end; day = addDays(day, 1)) unavailable.add(dateKey(day));
        }
        setBlocked(unavailable);
      } catch {
        setStatus('API indisponível. Inicie o servidor para consultar reservas.');
      }
    }
    void loadAvailability();
  }, [dates]);

  const nights = checkIn && checkOut ? Math.max(0, Math.round((new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86_400_000)) : 0;
  const total = property ? Number(property.nightly_rate) * nights : 0;
  const deposit = property ? total * Number(property.deposit_percentage) / 100 : 0;

  async function reserve() {
    if (!property || !checkIn || !checkOut || !termsAccepted || !nights) return setStatus('Selecione datas válidas e aceite os termos.');
    setStatus('Confirmando disponibilidade...');
    const response = await fetch(`${API_URL}/reservations`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: property.id, checkIn, checkOut, guestCount: 1, termsAccepted: true, idempotencyKey: crypto.randomUUID() })
    });
    if (response.status === 401) return setStatus('Faça login ou crie sua conta antes de reservar.');
    if (response.status === 409) return setStatus('Estas datas acabaram de ser ocupadas. Consulte novamente.');
    setStatus(response.ok ? 'Reserva criada e aguardando pagamento do sinal.' : 'Não foi possível criar a reserva.');
  }

  return <div className="booking-widget">
    <div className="calendar-head"><div><p className="eyebrow">Disponibilidade</p><h2>Escolha seus dias.</h2></div><span>Próximos 120 dias</span></div>
    <div className="date-grid">{dates.map((date) => { const key = dateKey(date); const unavailable = blocked.has(key); const selected = key === checkIn || key === checkOut; return <button className={selected ? 'date selected' : 'date'} disabled={unavailable} key={key} onClick={() => { if (!checkIn || (checkIn && checkOut)) { setCheckIn(key); setCheckOut(''); } else if (key > checkIn) setCheckOut(key); }}><small>{date.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })}</small><strong>{date.getUTCDate()}</strong></button>; })}</div>
    <div className="checkout-row"><div><label>Entrada<input type="date" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></label><label>Saída<input type="date" value={checkOut} min={checkIn} onChange={(event) => setCheckOut(event.target.value)} /></label></div><div className="quote"><span>{nights} noite(s)</span><strong>R$ {total.toFixed(2)}</strong><small>Sinal de 50%: R$ {deposit.toFixed(2)}</small></div></div>
    <label className="terms"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /> Aceito os Termos de Locação e Contrato.</label>
    <button className="button" type="button" onClick={() => void reserve()}>Solicitar reserva</button>{status && <p className="feedback">{status}</p>}
  </div>;
}
