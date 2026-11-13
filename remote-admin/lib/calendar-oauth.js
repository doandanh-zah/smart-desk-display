import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { randomHex, sha256, safeEquals } from './auth.js';
import { CALENDAR_SCOPE } from './integrations.js';

const callbackCookie = '__Host-smart-desk-google';
const callbackPath = '/api/auth/google/callback';

function tokenCipher(key) {
  return {
    seal(token) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString('base64url')).join('.');
    },
    open(sealed) {
      const [iv, tag, bytes] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv);
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(bytes), cipher.final()]).toString('utf8');
    },
  };
}

export function calendarOAuth({ env, db, origin, version, fetchImpl = fetch }) {
  const { GOOGLE_CALENDAR_CLIENT_ID: clientId, GOOGLE_CALENDAR_CLIENT_SECRET: clientSecret,
    GOOGLE_CALENDAR_TOKEN_KEY: secretKey } = env;
  if (!clientId || !clientSecret || !/^[a-f0-9]{64}$/.test(secretKey ?? '')) return null;
  const cipher = tokenCipher(Buffer.from(secretKey, 'hex'));
  const redirect = origin + callbackPath;
  const cookie = (value, ttl) => `${callbackCookie}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${ttl}`;
  const saved = () => db.calendarGrant();

  return {
    async connection() {
      const grant = await saved();
      return { connected: Boolean(grant), revision: grant?.revision ?? null };
    },
    async refreshToken() {
      const grant = await saved();
      return grant ? cipher.open(grant.sealed) : null;
    },
    async start(session) {
      const state = randomHex(32);
      const nonce = randomHex(32);
      const verifier = randomHex(32);
      await db.putCalendarState(sha256(state), { session, nonce: sha256(nonce), verifier });
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: CALENDAR_SCOPE,
        access_type: 'offline', prompt: 'consent select_account', state,
        code_challenge: Buffer.from(sha256(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256',
      });
      return { authorizationUrl: auth.toString(), cookie: cookie(nonce, 600) };
    },
    async complete(request, now) {
      const params = new URL(request.url).searchParams;
      const state = params.getAll('state');
      const codes = params.getAll('code');
      const nonces = (request.headers.get('cookie') ?? '').split(';').map((x) => x.trim())
        .filter((x) => x.startsWith(callbackCookie + '=')).map((x) => x.slice(callbackCookie.length + 1));
      if (state.length !== 1 || !/^[a-f0-9]{64}$/.test(state[0]) || nonces.length !== 1 ||
          !/^[a-f0-9]{64}$/.test(nonces[0])) return false;
      const grant = await db.takeCalendarState(sha256(state[0]), sha256(nonces[0]));
      if (!grant) return false;
      const session = await db.session(grant.session);
      if (!session || session.expiresAt <= now || !safeEquals(session.version, version) ||
          params.has('error') || codes.length !== 1 || !codes[0] || codes[0].length > 1024) return false;
      const response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4500),
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret, redirect_uri: redirect,
          grant_type: 'authorization_code', code: codes[0], code_verifier: grant.verifier,
        }),
      });
      if (!response.ok) return false;
      const token = await response.json();
      if (token.scope?.trim() !== CALENDAR_SCOPE ||
          typeof token.refresh_token !== 'string' || !token.refresh_token || token.refresh_token.length > 4096) return false;
      await db.putCalendarGrant({ sealed: cipher.seal(token.refresh_token), revision: randomHex(16) });
      return true;
    },
    clearCookie: () => cookie('', 0),
    async disconnect() {
      // Remove local access and cached titles even if upstream revocation fails.
      const grant = await db.removeCalendarGrant();
      if (!grant) return;
      try {
        const token = cipher.open(grant.sealed);
        await fetchImpl('https://oauth2.googleapis.com/revoke', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(2600),
          body: new URLSearchParams({ token }),
        });
      } catch {}
    },
  };
}
