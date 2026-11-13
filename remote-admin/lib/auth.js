import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = { N: 65536, r: 8, p: 1, maxmem: 80 * 1024 * 1024 };
const format = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
export const COOKIE = '__Host-smart-desk';
const SESSION_SECONDS = 28800;

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const randomHex = (bytes) => randomBytes(bytes).toString('hex');
export const validHash = (encoded) => typeof encoded === 'string' && format.test(encoded);

export async function passwordHash(password) {
  const salt = randomHex(16);
  const hash = await derive(password, Buffer.from(salt, 'hex'), 32, options);
  return `scrypt-v1$${salt}$${hash.toString('hex')}`;
}

export async function passwordMatches(password, encoded) {
  const [, salt, hex] = format.exec(encoded);
  const hash = await derive(password, Buffer.from(salt, 'hex'), 32, options);
  return timingSafeEqual(hash, Buffer.from(hex, 'hex'));
}

export function safeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));
}

export function sessionId(request) {
  const values = (request.headers.get('cookie') ?? '').split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(COOKIE + '='));
  const id = values.length === 1 ? values[0].slice(COOKIE.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(id) ? sha256(id) : null;
}

export function sessionCookie(id, age) {
  return `${COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
}

export function newSession(now, version) {
  return { id: randomHex(32), value: { csrfToken: randomHex(32), expiresAt: now + SESSION_SECONDS, version } };
}

export function viewSession(session) {
  if (!session) return { authenticated: false };
  return { authenticated: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
}
