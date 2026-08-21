import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  config
} from './config';
import { query } from './db';
import { forbidden, unauthorized } from './errors';

export const SESSION_COOKIE = 'session';
export const REFRESH_COOKIE = 'refresh';

export type Session = { id: string; role: 'CUSTOMER' | 'ADMIN' };

function secretKey() {
  return new TextEncoder().encode(config.jwtSecret);
}

// --------------------------------------------------------------------------
// Senhas
// --------------------------------------------------------------------------

/**
 * `@node-rs/argon2` em vez de `argon2`: o segundo compila na instalação, o que
 * quebra em runtime serverless e no Windows. Este traz binários pré-compilados.
 */
export async function hashPassword(password: string): Promise<string> {
  return argonHash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Access token (curto) + refresh token (longo, rotativo, revogável)
// --------------------------------------------------------------------------

async function signAccessToken(userId: string, role: string): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function setSessionCookies(userId: string, role: string, refreshToken: string) {
  const store = await cookies();
  const shared = {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/'
  };
  store.set(SESSION_COOKIE, await signAccessToken(userId, role), {
    ...shared,
    maxAge: ACCESS_TOKEN_TTL_SECONDS
  });
  store.set(REFRESH_COOKIE, refreshToken, {
    ...shared,
    maxAge: REFRESH_TOKEN_TTL_SECONDS
  });
}

export async function clearSessionCookies() {
  const store = await cookies();
  for (const name of [SESSION_COOKIE, REFRESH_COOKIE]) {
    store.set(name, '', { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/', maxAge: 0 });
  }
}

/** Cria a sessão persistente e grava os dois cookies. */
export async function startSession(
  userId: string,
  role: string,
  context: { ip?: string | null; userAgent?: string | null }
) {
  const refreshToken = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
    [
      userId,
      hashRefreshToken(refreshToken),
      context.userAgent?.slice(0, 400) ?? null,
      context.ip ?? null,
      String(REFRESH_TOKEN_TTL_SECONDS)
    ]
  );
  await setSessionCookies(userId, role, refreshToken);
}

/**
 * Rotaciona o refresh token. Se um token já usado reaparecer, tratamos como
 * vazamento e derrubamos todas as sessões daquele usuário.
 */
export async function rotateSession(context: { ip?: string | null; userAgent?: string | null }) {
  const store = await cookies();
  const presented = store.get(REFRESH_COOKIE)?.value;
  if (!presented) throw unauthorized('NO_REFRESH_TOKEN');

  const presentedHash = hashRefreshToken(presented);
  const found = await query<{
    id: string;
    user_id: string;
    revoked_at: string | null;
    expired: boolean;
    role: 'CUSTOMER' | 'ADMIN';
    status: string;
  }>(
    `SELECT s.id, s.user_id, s.revoked_at, s.expires_at <= now() AS expired, u.role, u.status
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.refresh_token_hash = $1`,
    [presentedHash]
  );

  const session = found.rows[0];
  if (!session) {
    await clearSessionCookies();
    throw unauthorized('INVALID_REFRESH_TOKEN');
  }

  if (session.revoked_at) {
    await query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'REUSE_DETECTED'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [session.user_id]
    );
    await clearSessionCookies();
    throw unauthorized('REFRESH_TOKEN_REUSED');
  }

  if (session.expired || session.status !== 'ACTIVE') {
    await query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'EXPIRED' WHERE id = $1`, [session.id]);
    await clearSessionCookies();
    throw unauthorized('SESSION_EXPIRED');
  }

  const nextToken = randomBytes(32).toString('base64url');
  await query(
    `UPDATE user_sessions
     SET refresh_token_hash = $2, last_used_at = now(),
         expires_at = now() + ($3 || ' seconds')::interval,
         user_agent = COALESCE($4, user_agent), ip = COALESCE($5, ip)
     WHERE id = $1`,
    [
      session.id,
      hashRefreshToken(nextToken),
      String(REFRESH_TOKEN_TTL_SECONDS),
      context.userAgent?.slice(0, 400) ?? null,
      context.ip ?? null
    ]
  );
  await setSessionCookies(session.user_id, session.role, nextToken);
  return { id: session.user_id, role: session.role } satisfies Session;
}

export async function revokeCurrentSession() {
  const store = await cookies();
  const presented = store.get(REFRESH_COOKIE)?.value;
  if (presented) {
    await query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'LOGOUT'
       WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
      [hashRefreshToken(presented)]
    );
  }
  await clearSessionCookies();
}

// --------------------------------------------------------------------------
// Guardas
// --------------------------------------------------------------------------

export async function requireUser(): Promise<Session> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) throw unauthorized();
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) throw unauthorized();
    const role = payload.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER';
    return { id: payload.sub, role };
  } catch {
    throw unauthorized();
  }
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireUser();
  if (session.role !== 'ADMIN') throw forbidden();
  return session;
}

/** Comparação de segredo resistente a timing (webhook, cron). */
export function secretMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
