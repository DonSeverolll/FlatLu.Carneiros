import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export async function createSession(userId: string, role: string) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

export async function requireUser(request: FastifyRequest) {
  const token = request.cookies.session;
  if (!token) throw new Error('UNAUTHORIZED');
  const { payload } = await jwtVerify(token, secret);
  if (!payload.sub) throw new Error('UNAUTHORIZED');
  return { id: payload.sub, role: String(payload.role) };
}

export async function requireAdmin(request: FastifyRequest) {
  const session = await requireUser(request);
  if (session.role !== 'ADMIN') throw new Error('FORBIDDEN');
  return session;
}
