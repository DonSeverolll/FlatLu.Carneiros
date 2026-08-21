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
const originalRate = (await db.query('select nightly_rate, pix_key from properties where id = $1', [propertyId])).rows[0];

// Datas bem no futuro, para não colidir com nada real.
const base = new Date();
base.setUTCDate(base.getUTCDate() + 300);
const iso = (offset) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const checkIn = iso(0);
const checkOut = iso(3);

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

  console.log('\n--- 2. guarda de tarifa não publicada');
  r = await g.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn, checkOut, guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-rate-${stamp}`
  }});
  check('reserva recusada com RATE_NOT_PUBLISHED', r.json?.error === 'RATE_NOT_PUBLISHED', `${r.status} ${r.json?.error}`);

  console.log('\n--- 3. admin publica tarifa e Pix');
  await db.query(`update users set role = 'ADMIN' where email = $1`, [guest.email]);
  const a = session();
  r = await a.call('/api/auth/login', { method: 'POST', body: { identifier: guest.email, password: guest.password } });
  check('login por e-mail funciona', r.status === 200 && r.json?.user?.role === 'ADMIN', r.json?.user?.role);

  r = await a.call(`/api/admin/properties/${propertyId}`, { method: 'PATCH', body: {
    nightlyRate: 650, depositPercentage: 50, minNights: 2, maxGuests: 4,
    pixKey: 'e2e-teste@pix.local', pixHolderName: 'Flat Praia de Carneiros'
  }});
  check('PATCH da propriedade aceito', r.status === 200, `${r.status} ${r.json?.error ?? ''}`);
  check('chave Pix não volta no corpo', !JSON.stringify(r.json).includes('e2e-teste@pix.local'));

  r = await a.call('/api/properties/flat-praia-de-carneiros');
  check('vitrine agora publica a diária', r.json?.property?.ratePublished === true);
  check('vitrine não expõe a chave Pix', !r.text.includes('e2e-teste@pix.local'));

  console.log('\n--- 4. regras de negócio');
  r = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn, checkOut: iso(1), guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-min-${stamp}`
  }});
  check('estadia de 1 noite recusada (mínimo 2)', r.json?.error === 'BELOW_MIN_NIGHTS', r.json?.error);

  r = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn, checkOut, guestCount: 9,
    termsAccepted: true, idempotencyKey: `e2e-max-${stamp}`
  }});
  check('9 hóspedes recusados (capacidade 4)', r.json?.error === 'ABOVE_MAX_GUESTS', r.json?.error);

  r = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn: '2020-01-01', checkOut: '2020-01-05', guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-past-${stamp}`
  }});
  check('data no passado recusada', r.json?.error === 'CHECKIN_IN_THE_PAST', r.json?.error);

  console.log('\n--- 5. reserva');
  const key = `e2e-ok-${stamp}`;
  r = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn, checkOut, guestCount: 2,
    termsAccepted: true, idempotencyKey: key
  }});
  check('reserva criada com 201', r.status === 201, `${r.status} ${r.json?.error ?? ''}`);
  const reservation = r.json?.reservation;
  check('3 noites x 650 = 1950,00', reservation?.total_amount === '1950.00', reservation?.total_amount);
  check('sinal de 50% = 975,00', reservation?.deposit_amount === '975.00', reservation?.deposit_amount);
  check('datas voltam como YYYY-MM-DD, sem deslocamento de fuso',
    reservation?.check_in === checkIn && reservation?.check_out === checkOut,
    `${reservation?.check_in} → ${reservation?.check_out}`);

  const repeat = await a.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn, checkOut, guestCount: 2,
    termsAccepted: true, idempotencyKey: key
  }});
  check('idempotência: mesma chave devolve a mesma reserva',
    repeat.status === 200 && repeat.json?.reservation?.id === reservation.id);

  console.log('\n--- 6. anti-overbooking');
  const rv = session();
  await rv.call('/api/auth/register', { method: 'POST', body: rival });
  r = await rv.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn: iso(1), checkOut: iso(4), guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-clash-${stamp}`
  }});
  check('datas sobrepostas recusadas com 409', r.status === 409 && r.json?.error === 'DATES_UNAVAILABLE',
    `${r.status} ${r.json?.error}`);

  r = await rv.call('/api/reservations', { method: 'POST', body: {
    propertyId: 'flat-praia-de-carneiros', checkIn: iso(3), checkOut: iso(5), guestCount: 2,
    termsAccepted: true, idempotencyKey: `e2e-adj-${stamp}`
  }});
  check('estadia encostada no check-out é aceita', r.status === 201, `${r.status} ${r.json?.error ?? ''}`);
  const adjacent = r.json?.reservation;

  r = await a.call('/api/properties/flat-praia-de-carneiros/availability');
  const unavailable = r.json?.unavailable ?? [];
  check('calendário passa a marcar as noites vendidas', unavailable.includes(checkIn) && unavailable.includes(iso(2)),
    `${unavailable.length} noites`);
  check('availability não expõe o motivo do bloqueio', !r.text.includes('RESERVATION') && !r.text.includes('source'));

  console.log('\n--- 7. cobrança Pix');
  r = await a.call(`/api/reservations/${reservation.id}/payment-intent`, { method: 'POST' });
  check('payment-intent devolve 201', r.status === 201, `${r.status} ${r.json?.error ?? ''}`);
  const intent = r.json;
  check('referência no formato CARN########', /^CARN[A-Z2-9]{8}$/.test(intent?.payment?.reference ?? ''), intent?.payment?.reference);
  check('cobrança é do valor do sinal', intent?.payment?.amount === '975.00', intent?.payment?.amount);
  const payload = intent?.pix?.payload ?? '';
  check('BR Code começa com 000201', payload.startsWith('000201'));
  check('BR Code traz valor 975.00', payload.includes('5406975.00'));
  check('CRC do BR Code confere', payload.slice(-4) === crc16(payload.slice(0, -4)), payload.slice(-4));

  const again = await a.call(`/api/reservations/${reservation.id}/payment-intent`, { method: 'POST' });
  check('cobrança é idempotente (mesma referência)',
    again.json?.payment?.reference === intent.payment.reference);

  r = await a.call(`/api/reservations/${reservation.id}/pix-qr`);
  check('QR renderizado como SVG', r.status === 200 && r.text.startsWith('<svg'), `${r.status}`);

  console.log('\n--- 8. pagamento parcial não expira a reserva');
  const before = (await db.query('select expires_at from reservations where id = $1', [reservation.id])).rows[0].expires_at;
  r = await a.call(`/api/admin/reservations/${reservation.id}/confirm-payment`, { method: 'POST', body: { amount: 975, status: 'PARTIAL' } });
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

  console.log('\n--- 9. pagamento total confirma');
  r = await a.call(`/api/admin/reservations/${reservation.id}/confirm-payment`, { method: 'POST', body: { amount: 1950, status: 'PAID' } });
  check('pagamento total aceito', r.status === 200 && r.json?.status === 'CONFIRMED', r.json?.status);

  console.log('\n--- 10. sessão: renovação e revogação');
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

  console.log('\n--- 11. autorização e auditoria');
  r = await rv.call('/api/admin/reservations?from=2026-01-01&to=2027-01-01');
  check('CUSTOMER recebe 403 no painel admin', r.status === 403, `${r.status} ${r.json?.error}`);
  r = await rv.call(`/api/reservations/${reservation.id}`);
  check('CUSTOMER não lê reserva de outro', r.status === 404, `${r.status} ${r.json?.error}`);

  const events = (await db.query(
    `select event_type from audit_events where entity_id = $1 order by created_at`, [reservation.id])).rows.map(r => r.event_type);
  check('trilha de auditoria registrada', events.includes('CREATED') && events.includes('PAYMENT_PARTIAL') && events.includes('PAYMENT_PAID'),
    events.join(' → '));

  console.log('\n--- 12. cancelamento libera a data');
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
  await db.query('update properties set nightly_rate = $2, pix_key = $3, pix_holder_name = null where id = $1',
    [propertyId, originalRate.nightly_rate, originalRate.pix_key]);
  const leftover = (await db.query(
    `select count(*)::int as n from reservations r join users u on u.id = r.customer_id where u.email like 'e2e-%'`)).rows[0].n;
  console.log(`  dados de teste removidos (sobras: ${leftover})`);
  const state = (await db.query('select nightly_rate, pix_key from properties where id = $1', [propertyId])).rows[0];
  console.log(`  propriedade restaurada: diária ${state.nightly_rate}, pix ${state.pix_key ?? '(nenhuma)'}`);
  await db.end();
  console.log(`\n=== ${passed} verificações ok, ${failed} falha(s) ===`);
  process.exit(failed ? 1 : 0);
}
