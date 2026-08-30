#!/usr/bin/env node
/**
 * Teste de fumaca ponta a ponta contra um banco real.
 *
 * Existe porque tres bugs de SQL passaram por typecheck, testes de unidade e
 * build sem serem notados: dois `ON CONFLICT` que nao inferiam indice parcial
 * e um parametro usado como enum e como texto na mesma query. Nenhum aparece
 * sem um PostgreSQL do outro lado.
 *
 * ATENCAO: cria usuarios `e2e-*@teste.local`, faz reservas e altera
 * temporariamente a diaria e a chave Pix da propriedade, restaurando tudo no
 * final. Nao rode contra producao em horario de venda.
 *
 *   BASE=http://localhost:3000 SMOKE_CONFIRM=1 npm run db:smoke
 */
import pg from 'pg';

if (process.env.SMOKE_CONFIRM !== '1') {
  console.error('Este teste escreve no banco e altera a diaria da propriedade temporariamente.');
  console.error('Confirme com SMOKE_CONFIRM=1 se e isso que voce quer.');
  process.exit(1);
}

const BASE = process.env.BASE ?? 'http://localhost:3000';
const stamp = process.env.STAMP ?? String(Date.now());
const guest = { email: `e2e-guest-${stamp}@teste.local`, password: 'senha-de-teste-e2e-123', fullName: 'Hospede Teste E2E' };
const rival = { email: `e2e-rival-${stamp}@teste.local`, password: 'senha-de-teste-e2e-123', fullName: 'Rival Teste E2E' };

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`); }
  else { failed += 1; console.log(`  FALHA ${label}${detail ? ' — ' + detail : ''}`); }
}

/** Cliente com cookie jar próprio, para simular navegadores distintos. */
function session() {
  const jar = new Map();
  return {
    jar,
    async call(path, { method = 'GET', body } = {}) {
      const headers = { Origin: BASE };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const response = await fetch(BASE + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual'
      });
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const index = pair.indexOf('=');
        const name = pair.slice(0, index);
        const value = pair.slice(index + 1);
        if (value === '' ) jar.delete(name); else jar.set(name, value);
      }
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* pode ser SVG */ }
      return { status: response.status, json, text };
    }
  };
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL.replace(':6543', ':5432'),
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000
});
await db.connect();

const propertyId = (await db.query(`select id from properties where slug = 'flat-praia-de-carneiros'`)).rows[0].id;
const original = (await db.query(
  `select nightly_rate, pix_key, min_nights, deposit_percentage, max_guests,
          address_line, legal_forum from properties where id = $1`,
  [propertyId]
)).rows[0];

// Datas bem no futuro, para não colidir com nada real.
const base = new Date();
base.setUTCDate(base.getUTCDate() + 300);
const iso = (offset) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
/** Primeiro `dow` (0=dom..6=sab) a partir de um deslocamento. */
const nextWeekday = (offsetFrom, dow) => {
  for (let step = offsetFrom; step < offsetFrom + 7; step += 1) {
    const day = iso(step);
    const [y, m, d] = day.split('-').map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === dow) return day;
  }
  throw new Error('dia da semana nao encontrado');
};
const addDays = (day, amount) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
};

const MONDAY = nextWeekday(0, 1);
const THURSDAY = addDays(MONDAY, 3);
const FRIDAY = nextWeekday(10, 5);
const SATURDAY = addDays(FRIDAY, 1);
const SUNDAY = addDays(FRIDAY, 2);

// Reserva de teste: bem depois dos dias usados nas checagens de preco.
const checkIn = nextWeekday(25, 1);
const checkOut = addDays(checkIn, 3);

try {
  console.log('\n--- 1. cadastro e sessão');
  const g = session();
  let r = await g.call('/api/auth/register', { method: 'POST', body: guest });
  check('cadastro devolve 201', r.status === 201, `status ${r.status}`);
  check('cookies de sessão e refresh emitidos', g.jar.has('session') && g.jar.has('refresh'));
  check('papel inicial é CUSTOMER', r.json?.user?.role === 'CUSTOMER', r.json?.user?.role);

  r = await g.call('/api/auth/register', { method: 'POST', body: guest });
  check('e-mail repetido devolve 409 (não 500)', r.status === 409, `${r.status} ${r.json?.error ?? ''}`);

  r = await g.call('/api/auth/me');
  check('/auth/me autenticado', r.status === 200 && r.json?.user?.email === guest.email);

  // A guarda de "tarifa não publicada" é coberta em rates.test.ts: com o
  // calendário preenchido não há estado sem tarifa para exercitar aqui sem
  // apagar a tabela de preços real.

  console.log('\n--- 2. admin publica tarifa e Pix');
  await db.query(`update users set role = 'ADMIN' where email = $1`, [guest.email]);
  const a = session();
  r = await a.call('/api/auth/login', { method: 'POST', body: { identifier: guest.email, password: guest.password } });
  check('login por e-mail funciona', r.status === 200 && r.json?.user?.role === 'ADMIN', r.json?.user?.role);

  r = await a.call(`/api/admin/properties/${propertyId}`, { method: 'PATCH', body: {
    depositPercentage: 50, minNights: 1,
    pixKey: 'e2e-teste@pix.local', pixHolderName: 'Flat Praia de Carneiros'
  }});
  check('PATCH da propriedade aceito', r.status === 200, `${r.status} ${r.json?.error ?? ''}`);
  check('chave Pix não volta no corpo', !JSON.stringify(r.json).includes('e2e-teste@pix.local'));

  await db.query(
    `update properties set address_line = COALESCE(address_line, 'Rua de Teste, 1'),
                           legal_forum = COALESCE(legal_forum, 'Tamandaré') where id = $1`,
    [propertyId]);

  r = await a.call('/api/properties/flat-praia-de-carneiros');
  check('vitrine agora publica a diária', r.json?.property?.ratePublished === true);
  check('vitrine não expõe a chave Pix', !r.text.includes('e2e-teste@pix.local'));

  console.log('\n--- 3. calendário de tarifas');
  const quoteFor = async (from, to) =>
    (await a.call(`/api/properties/flat-praia-de-carneiros/quote?checkIn=${from}&checkOut=${to}`)).json;

  let q = await quoteFor(MONDAY, THURSDAY);
  check('segunda a quinta: 3 noites x 300 = 900', q?.quote?.totalAmount === '900.00',
    `${q?.quote?.totalAmount} em ${q?.quote?.nights} noites`);

  q = await quoteFor(SATURDAY, SUNDAY);
  check('sábado para domingo: 1000', q?.quote?.totalAmount === '1000.00', q?.quote?.totalAmount);

  q = await quoteFor(FRIDAY, SUNDAY);
  check('sexta a domingo: 400 + 1000 = 1400', q?.quote?.totalAmount === '1400.00', q?.quote?.totalAmount);
  check('extrato detalha cada noite', (q?.quote?.lines ?? []).length === 2,
    (q?.quote?.lines ?? []).map((l) => l.label).join(' + '));
  check('sinal de 50% sobre 1400 = 700', q?.quote?.depositAmount === '700.00', q?.quote?.depositAmount);

  console.log('\n--- 4. regras de negócio');
  await a.call(`/api/admin/properties/${propertyId}`, { method: 'PATCH', body: { minNights: 2 } });
  r = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn, checkOut: addDays(checkIn, 1), guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-min-${stamp}`
  }});
  check('estadia de 1 noite recusada quando o mínimo é 2', r.json?.error === 'BELOW_MIN_NIGHTS',
    `${r.status} ${r.json?.error}`);
  check('mínimo é devolvido ao cliente', r.json?.details?.minNights === 2, String(r.json?.details?.minNights));
  await a.call(`/api/admin/properties/${propertyId}`, { method: 'PATCH', body: { minNights: 1 } });

  r = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn, checkOut, guestCount: 9,
    termsAccepted: true, idempotencyKey: `e2e-max-${stamp}`
  }});
  check('9 hóspedes recusados (flat acomoda 7)', r.json?.error === 'ABOVE_MAX_GUESTS',
    `${r.json?.error} max=${r.json?.details?.maxGuests}`);

  r = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn: '2020-01-01', checkOut: '2020-01-05', guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-past-${stamp}`
  }});
  check('data no passado recusada', r.json?.error === 'CHECKIN_IN_THE_PAST', r.json?.error);

  console.log('\n--- 5. reserva');
  const expected = await quoteFor(checkIn, checkOut);
  const key = `e2e-ok-${stamp}`;
  r = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn, checkOut, guestCount: 2,
    termsAccepted: true, idempotencyKey: key
  }});
  check('reserva criada com 201', r.status === 201, `${r.status} ${r.json?.error ?? ''}`);
  const reservation = r.json?.reservation;
  // O que importa não é um número fixo: é o valor cobrado bater com o exibido.
  check('total gravado bate com o orçamento mostrado',
    reservation?.total_amount === expected?.quote?.totalAmount,
    `reserva ${reservation?.total_amount} vs orçamento ${expected?.quote?.totalAmount}`);
  check('sinal gravado bate com o orçamento',
    reservation?.deposit_amount === expected?.quote?.depositAmount,
    `${reservation?.deposit_amount} vs ${expected?.quote?.depositAmount}`);
  check('datas voltam como YYYY-MM-DD, sem deslocamento de fuso',
    reservation?.check_in === checkIn && reservation?.check_out === checkOut,
    `${reservation?.check_in} → ${reservation?.check_out}`);

  const repeat = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn, checkOut, guestCount: 2,
    termsAccepted: true, idempotencyKey: key
  }});
  check('idempotência: mesma chave devolve a mesma reserva',
    repeat.status === 200 && repeat.json?.reservation?.id === reservation.id);

  console.log('\n--- 6. independência entre os espaços');
  const cal = (await a.call('/api/units')).json;
  check('as três unidades vêm em uma resposta', (cal?.units ?? []).length === 3,
    (cal?.units ?? []).map((u) => u.shortName).join(', '));
  check('cada unidade tem cor própria',
    new Set((cal?.units ?? []).map((u) => u.color)).size === (cal?.units ?? []).length,
    (cal?.units ?? []).map((u) => `${u.shortName}=${u.color}`).join(' '));
  check('capacidades conferem com a tabela',
    (cal?.units ?? []).every((u) => u.slug === 'flat-praia-de-carneiros' ? u.maxGuests === 7 : u.maxGuests === 10),
    (cal?.units ?? []).map((u) => `${u.shortName}:${u.maxGuests}`).join(' '));

  // A reserva do flat (seção 5) não pode ter ocupado a casa nas mesmas datas.
  const others = (cal?.units ?? []).filter((u) => u.slug !== 'flat-praia-de-carneiros');
  const leaked = others.filter((u) => (u.unavailable ?? []).includes(checkIn));
  check('reservar o flat não ocupa a casa nas mesmas datas', leaked.length === 0,
    leaked.length ? leaked.map((u) => u.shortName).join(', ') : 'nenhum vazamento');

  const casa = others[0];
  q = await quoteFor(checkIn, checkOut);
  const casaQuote = (await a.call(
    `/api/properties/${casa.slug}/quote?checkIn=${checkIn}&checkOut=${checkOut}`)).json;
  check('a casa continua disponível e com tarifa própria',
    casaQuote?.available === true && casaQuote?.quote?.totalAmount !== q?.quote?.totalAmount,
    `casa ${casaQuote?.quote?.totalAmount} vs flat ${q?.quote?.totalAmount}`);

  r = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: casa.slug, checkIn, checkOut, guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-casa-${stamp}`
  }});
  check('mesma data em espaço diferente é aceita', r.status === 201,
    `${r.status} ${r.json?.error ?? ''}`);
  const casaReservation = r.json?.reservation;
  check('valor da casa segue a tarifa da casa',
    casaReservation?.total_amount === casaQuote?.quote?.totalAmount,
    `${casaReservation?.total_amount}`);

  console.log('\n--- 7. anti-overbooking dentro do mesmo espaço');
  const rv = session();
  await rv.call('/api/auth/register', { method: 'POST', body: rival });
  r = await rv.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn: addDays(checkIn, 1), checkOut: addDays(checkIn, 4), guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-clash-${stamp}`
  }});
  check('datas sobrepostas recusadas com 409', r.status === 409 && r.json?.error === 'DATES_UNAVAILABLE',
    `${r.status} ${r.json?.error}`);

  /**
   * Snapshot com APENAS a primeira reserva no calendário: é aqui que se mede
   * se o estoque é por noite. Uma estadia de 3 noites deve consumir 3 noites —
   * nem a véspera do check-in, nem o dia do check-out.
   */
  const antes = (await a.call('/api/properties/flat-praia-de-carneiros/availability')).json?.unavailable ?? [];
  check('estadia de 3 noites consome exatamente 3 noites', antes.length === 3, `${antes.length}: ${antes.join(', ')}`);
  check('o dia do check-out continua vendável', !antes.includes(checkOut),
    `${checkOut} ${antes.includes(checkOut) ? 'BLOQUEADO' : 'livre'}`);
  check('a véspera do check-in continua vendável', !antes.includes(addDays(checkIn, -1)),
    `${addDays(checkIn, -1)} ${antes.includes(addDays(checkIn, -1)) ? 'BLOQUEADA' : 'livre'}`);

  r = await rv.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn: addDays(checkIn, 3), checkOut: addDays(checkIn, 5), guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-adj-${stamp}`
  }});
  check('estadia encostada no check-out é aceita', r.status === 201, `${r.status} ${r.json?.error ?? ''}`);
  const adjacent = r.json?.reservation;

  r = await a.call('/api/properties/flat-praia-de-carneiros/availability');
  const unavailable = r.json?.unavailable ?? [];
  check('calendário passa a marcar as noites vendidas', unavailable.includes(checkIn) && unavailable.includes(addDays(checkIn, 2)),
    `${unavailable.length} noites`);

  check('availability não expõe o motivo do bloqueio', !r.text.includes('RESERVATION') && !r.text.includes('source'));

  console.log('\n--- 8. contrato');
  r = await a.call(`/api/reservations/${reservation.id}/payment-intent`, { method: 'POST' });
  check('cobrança recusada antes do contrato assinado', r.json?.error === 'CONTRACT_NOT_SIGNED',
    `${r.status} ${r.json?.error}`);

  let c = await a.call(`/api/reservations/${reservation.id}/contract`);
  check('fluxo aponta os dados que faltam', (c.json?.missingCustomerData ?? []).length > 0,
    (c.json?.missingCustomerData ?? []).join(', '));

  r = await a.call(`/api/reservations/${reservation.id}/contract`, { method: 'POST' });
  check('emissão recusada sem qualificação', r.status === 422 && r.json?.error === 'CUSTOMER_DATA_INCOMPLETE',
    `${r.status} ${r.json?.error}`);

  r = await a.call('/api/users/me/qualification', { method: 'PUT', body: {
    fullName: guest.fullName, documentNumber: '103.352.634-70', rg: '963247', rgIssuer: 'SDS/PE',
    nationality: 'brasileira', profession: 'assistente administrativa', maritalStatus: 'solteira',
    addressLine: 'Rua 85, nº 05, Caetés 3', addressCity: 'Abreu e Lima',
    addressState: 'PE', addressZip: '53545-750'
  }});
  check('qualificação salva', r.status === 200, `${r.status} ${r.json?.error ?? ''}`);

  r = await a.call(`/api/reservations/${reservation.id}/contract`, { method: 'POST' });
  check('contrato emitido', r.status === 201, `${r.status} ${r.json?.error ?? ''}`);
  const corpo = r.json?.contract?.body ?? '';
  check('sem marcador não preenchido no texto', !corpo.includes('{{'),
    (corpo.match(/\{\{[a-z_]+\}\}/g) ?? []).join(', ') || 'nenhum');
  check('contrato traz o valor por extenso', corpo.includes('novecentos reais'),
    corpo.match(/R\$ [\d.,]+ \([^)]+\)/)?.[0] ?? 'não encontrado');
  check('contrato traz o nome do locatário', corpo.includes(guest.fullName));
  check('contrato traz a comarca do foro', /Foro da Comarca de \S+/.test(corpo));
  check('contrato traz os horários', corpo.includes('09:00') && corpo.includes('16:00'));

  r = await a.call(`/api/reservations/${reservation.id}/contract/sign`, { method: 'POST', body: {
    signerName: 'Outra Pessoa Qualquer', signerCpf: '103.352.634-70', accepted: true }});
  check('assinatura com nome divergente é recusada', r.json?.error === 'SIGNER_NAME_MISMATCH', r.json?.error);

  r = await a.call(`/api/reservations/${reservation.id}/contract/sign`, { method: 'POST', body: {
    signerName: guest.fullName, signerCpf: '000.000.000-00', accepted: true }});
  check('assinatura com CPF divergente é recusada', r.json?.error === 'SIGNER_CPF_MISMATCH', r.json?.error);

  r = await a.call(`/api/reservations/${reservation.id}/contract/sign`, { method: 'POST', body: {
    signerName: guest.fullName, signerCpf: '103.352.634-70', accepted: true }});
  check('assinatura registrada', r.status === 200 && !r.json?.alreadySigned, `${r.status} ${r.json?.error ?? ''}`);
  check('hash de assinatura gerado', /^[0-9a-f]{64}$/.test(r.json?.signatureHash ?? ''),
    (r.json?.signatureHash ?? '').slice(0, 16));

  const assinado = (await db.query(
    `select status::text, signer_ip::text, signed_at, body_hash from contracts where reservation_id = $1`,
    [reservation.id])).rows[0];
  check('contrato gravado como SIGNED com IP e instante',
    assinado?.status === 'SIGNED' && assinado?.signed_at && assinado?.signer_ip,
    `${assinado?.status} ip=${assinado?.signer_ip}`);

  r = await a.call(`/api/reservations/${reservation.id}/contract/sign`, { method: 'POST', body: {
    signerName: guest.fullName, signerCpf: '103.352.634-70', accepted: true }});
  check('assinar de novo é idempotente', r.json?.alreadySigned === true, JSON.stringify(r.json));

  console.log('\n--- 9. cobrança Pix');
  r = await a.call(`/api/reservations/${reservation.id}/payment-intent`, { method: 'POST' });
  check('payment-intent devolve 201', r.status === 201, `${r.status} ${r.json?.error ?? ''}`);
  const intent = r.json;
  check('referência no formato CARN########', /^CARN[A-Z2-9]{8}$/.test(intent?.payment?.reference ?? ''), intent?.payment?.reference);
  check('cobrança é do valor do sinal', intent?.payment?.amount === expected.quote.depositAmount,
    `${intent?.payment?.amount} vs ${expected.quote.depositAmount}`);
  const payload = intent?.pix?.payload ?? '';
  check('BR Code começa com 000201', payload.startsWith('000201'));
  // Tag 54 do BR Code: tamanho + valor, ex. "5406450.00" para R$ 450,00.
  const amountTag = `54${String(expected.quote.depositAmount.length).padStart(2, '0')}${expected.quote.depositAmount}`;
  check(`BR Code traz o valor do sinal (${expected.quote.depositAmount})`, payload.includes(amountTag), amountTag);
  check('CRC do BR Code confere', payload.slice(-4) === crc16(payload.slice(0, -4)), payload.slice(-4));

  const again = await a.call(`/api/reservations/${reservation.id}/payment-intent`, { method: 'POST' });
  check('cobrança é idempotente (mesma referência)',
    again.json?.payment?.reference === intent.payment.reference);

  r = await a.call(`/api/reservations/${reservation.id}/pix-qr`);
  check('QR renderizado como SVG', r.status === 200 && r.text.startsWith('<svg'), `${r.status}`);

  console.log('\n--- 10. pagamento parcial não expira a reserva');
  const before = (await db.query('select expires_at from reservations where id = $1', [reservation.id])).rows[0].expires_at;
  r = await a.call(`/api/admin/reservations/${reservation.id}/confirm-payment`, { method: 'POST', body: { amount: Number(expected.quote.depositAmount), status: 'PARTIAL' } });
  check('sinal confirmado', r.status === 200, `${r.status} ${r.json?.error ?? ''}`);
  const afterPartial = (await db.query('select status, payment_status, expires_at from reservations where id = $1', [reservation.id])).rows[0];
  check('reserva segue viva como PENDING_PAYMENT', afterPartial.status === 'PENDING_PAYMENT', afterPartial.status);
  check('pagamento marcado como PARTIAL', afterPartial.payment_status === 'PARTIAL', afterPartial.payment_status);
  check('hold estendido em vez de expirar', afterPartial.expires_at > before,
    `${before.toISOString().slice(0,16)} → ${afterPartial.expires_at.toISOString().slice(0,16)}`);

  // O varredor roda em toda consulta de disponibilidade; se ele fosse expirar
  // uma reserva com sinal pago, seria aqui.
  await a.call('/api/properties/flat-praia-de-carneiros/availability');
  const survived = (await db.query('select status from reservations where id = $1', [reservation.id])).rows[0];
  check('varredor de holds não expira quem já pagou', survived.status === 'PENDING_PAYMENT', survived.status);

  console.log('\n--- 11. pagamento total confirma');
  r = await a.call(`/api/admin/reservations/${reservation.id}/confirm-payment`, { method: 'POST', body: { amount: Number(expected.quote.totalAmount), status: 'PAID' } });
  check('pagamento total aceito', r.status === 200 && r.json?.status === 'CONFIRMED', r.json?.status);

  console.log('\n--- 12. sessão: renovação e revogação');
  const oldRefresh = a.jar.get('refresh');
  r = await a.call('/api/auth/refresh', { method: 'POST' });
  check('refresh renova a sessão', r.status === 200, `${r.status} ${r.json?.error ?? ''}`);
  check('refresh token rotacionado', a.jar.get('refresh') !== oldRefresh);

  const replay = session();
  replay.jar.set('refresh', oldRefresh);
  r = await replay.call('/api/auth/refresh', { method: 'POST' });
  check('replay imediato tratado como corrida entre abas, sem derrubar sessões',
    r.status === 401 && r.json?.error === 'REFRESH_RACE', `${r.status} ${r.json?.error}`);
  // O usuário tem duas sessões legítimas aqui (cadastro + login como admin);
  // o que importa é que a corrida não revogou nenhuma delas.
  let live = (await db.query(
    `select count(*)::int as n from user_sessions s join users u on u.id = s.user_id
     where u.email = $1 and s.revoked_at is null`, [guest.email])).rows[0].n;
  check('sessões ativas sobrevivem à corrida', live >= 1, `${live} ativa(s)`);

  // Fora da janela de 10s, o mesmo token e replay de verdade.
  await db.query(
    `update user_sessions set revoked_at = now() - interval '2 minutes'
     where refresh_token_hash = encode(digest($1, 'sha256'), 'hex')`, [oldRefresh]);
  r = await replay.call('/api/auth/refresh', { method: 'POST' });
  check('token antigo fora da janela é tratado como reuso',
    r.status === 401 && r.json?.error === 'REFRESH_TOKEN_REUSED', `${r.status} ${r.json?.error}`);
  live = (await db.query(
    `select count(*)::int as n from user_sessions s join users u on u.id = s.user_id
     where u.email = $1 and s.revoked_at is null`, [guest.email])).rows[0].n;
  check('reuso derruba todas as sessões do usuário', live === 0, `${live} ativa(s)`);

  console.log('\n--- 13. autorização e auditoria');
  r = await rv.call('/api/admin/reservations?from=2026-01-01&to=2027-01-01');
  check('CUSTOMER recebe 403 no painel admin', r.status === 403, `${r.status} ${r.json?.error}`);
  r = await rv.call(`/api/reservations/${reservation.id}`);
  check('CUSTOMER não lê reserva de outro', r.status === 404, `${r.status} ${r.json?.error}`);

  const events = (await db.query(
    `select event_type from audit_events where entity_id = $1 order by created_at`, [reservation.id])).rows.map(r => r.event_type);
  check('trilha de auditoria registrada', events.includes('CREATED') && events.includes('PAYMENT_PARTIAL') && events.includes('PAYMENT_PAID'),
    events.join(' → '));

  console.log('\n--- 14. cancelamento libera a data');
  r = await a.call(`/api/admin/reservations/${adjacent.id}/cancel`, { method: 'POST', body: { reason: 'Teste E2E', refund: false } });
  check('cancelamento aceito', r.status === 200, `${r.status} ${r.json?.error ?? ''}`);
  const blocks = (await db.query(
    `select count(*)::int as n from inventory_blocks where reservation_id = $1 and active = true`, [adjacent.id])).rows[0].n;
  check('bloqueio de estoque desativado', blocks === 0, `${blocks} ativos`);
} finally {
  console.log('\n--- limpeza');
  const emails = [guest.email, rival.email];
  const ids = (await db.query('select id from users where email = any($1::text[])', [emails])).rows.map(r => r.id);
  if (ids.length) {
    await db.query(`delete from audit_events where actor_user_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from payments where reservation_id in (select id from reservations where customer_id = any($1::uuid[]))`, [ids]);
    await db.query(`delete from inventory_blocks where reservation_id in (select id from reservations where customer_id = any($1::uuid[]))`, [ids]);
    await db.query(`delete from audit_events where entity_id in (select id from reservations where customer_id = any($1::uuid[]))`, [ids]);
    await db.query(`delete from reservations where customer_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from user_sessions where user_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from users where id = any($1::uuid[])`, [ids]);
  }
  await db.query(`delete from auth_attempts where identifier = any($1::text[])`, [emails]);
  // Devolve a propriedade ao estado anterior: não publico preço que não é meu.
  await db.query(
    `update properties set nightly_rate = $2, pix_key = $3, pix_holder_name = null,
            min_nights = $4, deposit_percentage = $5, max_guests = $6,
            address_line = $7, legal_forum = $8 where id = $1`,
    [propertyId, original.nightly_rate, original.pix_key, original.min_nights,
     original.deposit_percentage, original.max_guests, original.address_line,
     original.legal_forum]);
  await db.query(`delete from contracts where reservation_id in (
    select id from reservations where customer_id in (
      select id from users where email like 'e2e-%'))`);
  const leftover = (await db.query(
    `select count(*)::int as n from reservations r join users u on u.id = r.customer_id where u.email like 'e2e-%'`)).rows[0].n;
  console.log(`  dados de teste removidos (sobras: ${leftover})`);
  const state = (await db.query('select nightly_rate, pix_key from properties where id = $1', [propertyId])).rows[0];
  console.log(`  propriedade restaurada: diária ${state.nightly_rate}, pix ${state.pix_key ?? '(nenhuma)'}`);
  await db.end();
  console.log(`\n=== ${passed} verificações ok, ${failed} falha(s) ===`);
  process.exit(failed ? 1 : 0);
}
