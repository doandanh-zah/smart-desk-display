import { calendarOAuth } from './calendar-oauth.js';
import { googleCalendar, integrations } from './integrations.js';
import { isIP } from 'node:net';
import { redisClient, store } from './redis.js';
import { commandPayload, ID, keys, syncRequest, TOKEN } from './validate.js';
import { newSession, passwordMatches, safeEquals, sessionCookie, sessionId, sha256, validHash, viewSession } from './auth.js';

const CANONICAL_ORIGIN = 'https://desk.thezah.space';
const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
};
const messages = {
  setup_required: 'Bảng điều khiển từ xa chưa được thiết lập.',
  unauthorized: 'Vui lòng đăng nhập.',
  invalid_credentials: 'Mật khẩu không đúng.',
  rate_limited: 'Quá nhiều yêu cầu. Hãy thử lại sau.',
  forbidden: 'Yêu cầu không được phép.',
  invalid_json: 'Dữ liệu JSON không hợp lệ.',
  invalid_field: 'Dữ liệu không hợp lệ.',
  unsupported_media_type: 'Yêu cầu cần JSON.',
  body_too_large: 'Dữ liệu vượt giới hạn.',
  not_found: 'Không tìm thấy.',
  method_not_allowed: 'Phương thức không được hỗ trợ.',
  device_offline: 'Thiết bị hiện không trực tuyến.',
  command_pending: 'Thiết bị đang xử lý lệnh trước.',
  id_conflict: 'ID lệnh đã được sử dụng.',
  invalid_device_time: 'Thời gian thiết bị chưa đồng bộ.',
  replay: 'Yêu cầu thiết bị đã được xử lý.',
  unavailable: 'Dịch vụ tạm thời gián đoạn.',
};

class HttpError extends Error {
  constructor(status, code, responseHeaders = {}) {
    super(code);
    this.status = status;
    this.responseHeaders = responseHeaders;
  }
}

const fail = (status, code, responseHeaders) => { throw new HttpError(status, code, responseHeaders); };
const json = (body, status = 200, extra = {}) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });
const html = (body, status = 200) => new Response(body, {
  status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
});
const setup = () => html('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Smart Desk Display</title><main><h1>Smart Desk Display</h1><p>Bảng điều khiển từ xa chưa được thiết lập.</p></main></html>', 503);

function configFrom(env) {
  const { ADMIN_PASSWORD_HASH: password, DEVICE_TOKEN_SHA256: deviceHash } = env;
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!validHash(password) ||
      !TOKEN.test(deviceHash ?? '') || !/^https:\/\/[a-z0-9.-]+\/?$/.test(url ?? '') ||
      !token) return null;
  return { password, deviceHash, url, token, version: sha256(password) };
}

async function body(request, max) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    fail(415, 'unsupported_media_type');
  }
  if (!request.body) fail(400, 'invalid_json');
  if (Number(request.headers.get('content-length')) > max) fail(413, 'body_too_large');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let raw = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        void reader.cancel().catch(() => {});
        fail(413, 'body_too_large');
      }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, 'invalid_json');
  }
}

function requireMethod(request, method) {
  if (request.method !== method) fail(405, 'method_not_allowed', { Allow: method });
}

function browserOrigin(request, origin) {
  if (request.headers.get('origin') !== origin) fail(403, 'forbidden');
}

function clientIp(request) {
  const address = request.headers.get('x-vercel-forwarded-for')?.trim() ?? '';
  return isIP(address) ? sha256(address) : 'unknown';
}

function limitOrThrow([count, ttl], max) {
  if (count > max) fail(429, 'rate_limited', { 'Retry-After': String(Math.max(1, ttl)) });
}

function publicCommand(command, now) {
  if (!command) return null;
  const { id, type, payload, createdAt, expiresAt, state, ack, queuedAtMs, deliveredAtMs, acknowledgedAtMs } = command;
  return { id, type, payload, createdAt, expiresAt,
    state: state === 'queued' && now >= expiresAt ? 'expired' : state, ack,
    queuedAtMs: queuedAtMs ?? createdAt * 1000, deliveredAtMs: deliveredAtMs ?? null,
    acknowledgedAtMs: acknowledgedAtMs ?? null };
}

function deviceCommand(command) {
  if (!command) return null;
  const { id, type, payload, createdAt, expiresAt } = command;
  return { id, type, payload, createdAt, expiresAt };
}

const loginAssets = new Set(['/styles.css', '/remote-login.js', '/zah-avatar.webp']);
const contentTypes = new Map([
  ['/styles.css', 'text/css; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/preview.js', 'text/javascript; charset=utf-8'],
  ['/transport.js', 'text/javascript; charset=utf-8'],
  ['/remote-login.js', 'text/javascript; charset=utf-8'],
  ['/zah-avatar.webp', 'image/webp'],
  ['/solana-devnet.png', 'image/png'],
]);

export function createGateway({ env = process.env, storage, assets, waitUntil, fetchCalendar, fetchGoogle, nowMs = Date.now, now = () => Math.floor(nowMs() / 1000) } = {}) {
  const config = configFrom(env);
  const origin = CANONICAL_ORIGIN;
  const db = config && (storage ?? store(redisClient(config)));

  const oauth = config && calendarOAuth({ env, db, origin, version: config.version, fetchImpl: fetchGoogle });
  const integrationView = config && integrations(db, { env, waitUntil,
    fetchCalendar: fetchCalendar ?? (oauth ? googleCalendar(env, fetchGoogle, oauth.refreshToken) : undefined),
    calendarConnection: oauth?.connection,
  });

  async function loadSession(request, time) {
    const id = sessionId(request);
    const session = id ? await db.session(id) : null;
    return session?.expiresAt > time && session.version === config.version ? session : null;
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (url.origin !== origin) {
        if (request.method === 'GET' || request.method === 'HEAD') {
          return new Response(null, { status: 308, headers: { ...headers, Location: origin + path } });
        }
        fail(403, 'forbidden');
      }

      if (!config) {
        if (path === '/' && ['GET', 'HEAD'].includes(request.method)) return setup();
        fail(503, 'setup_required');
      }
      const time = now();
      if (contentTypes.has(path)) {
        requireMethod(request, 'GET');
        if (!loginAssets.has(path) && !await loadSession(request, time)) fail(401, 'unauthorized');
        const asset = await assets(path.slice(1));
        return new Response(asset, { headers: { ...headers, 'Content-Type': contentTypes.get(path) } });
      }

      if (path === '/api/auth/google/callback') {
        requireMethod(request, 'GET');
        if (!oauth) fail(503, 'setup_required');
        const connected = await oauth.complete(request, time).catch(() => false);
        return new Response(null, { status: 303, headers: { ...headers,
          Location: connected ? '/?calendar=connected#calendar' : '/?calendar=failed#calendar',
          'Set-Cookie': oauth.clearCookie(),
        } });
      }

      if (path === '/api/device/sync') {
        requireMethod(request, 'POST');
        if (request.headers.has('origin')) fail(403, 'forbidden');
        const bearer = request.headers.get('authorization')?.slice(7);
        if (!request.headers.get('authorization')?.startsWith('Bearer ') ||
            !TOKEN.test(bearer ?? '') || !safeEquals(sha256(bearer), config.deviceHash)) fail(401, 'unauthorized');
        const input = syncRequest(await body(request, 6144));
        if (!input) fail(400, 'invalid_field');
        if (Math.abs(input.ts - time) > 90) fail(409, 'invalid_device_time');
        const result = await db.sync({ ...input, now: time, nowMs: nowMs() });
        if (result.state === 'replay') fail(409, 'replay');
        const output = { ok: true, serverTime: time, ackId: result.ackId, command: deviceCommand(result.command) };
        if (input.pollHints && result.pollAfterMs) output.pollAfterMs = result.pollAfterMs;
        else if (result.pollAfterMs === 3000) output.pollAfterMs = 3000;
        if (input.wantIntegrations) output.integrations = await integrationView(time, true);
        return json(output);
      }

      if (path === '/api/auth/login') {
        requireMethod(request, 'POST');
        browserOrigin(request, origin);
        const input = await body(request, 1024);
        if (!keys(input, ['password']) || typeof input.password !== 'string' ||
            !input.password.length || Buffer.byteLength(input.password) > 256) fail(400, 'invalid_field');
        limitOrThrow(await db.limit('login-ip:' + clientIp(request), 900), 6);
        limitOrThrow(await db.limit('login-global', 900), 30);
        if (!await passwordMatches(input.password, config.password)) fail(401, 'invalid_credentials');
        const prior = sessionId(request);
        if (prior) await db.deleteSession(prior);
        const session = newSession(time, config.version);
        await db.putSession(sha256(session.id), session.value);
        return json(viewSession(session.value), 200, { 'Set-Cookie': sessionCookie(session.id, 28800) });
      }

      if (path === '/') {
        requireMethod(request, 'GET');
        const session = await loadSession(request, time);
        return html(await assets(session ? 'index.html' : 'login.html'));
      }
      if (path === '/api/auth/session') {
        requireMethod(request, 'GET');
        return json(viewSession(await loadSession(request, time)));
      }

      if (path !== '/api/auth/logout' && !path.startsWith('/api/admin/')) fail(404, 'not_found');
      const session = await loadSession(request, time);
      if (!session) fail(401, 'unauthorized');
      if (request.method === 'POST') {
        browserOrigin(request, origin);
        if (!safeEquals(request.headers.get('x-csrf-token'), session.csrfToken)) fail(403, 'forbidden');
      }

      if (path === '/api/auth/logout') {
        requireMethod(request, 'POST');
        if (!keys(await body(request, 128), [])) fail(400, 'invalid_field');
        await db.deleteSession(sessionId(request));
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
      }

      if (path === '/api/admin/calendar/connect' || path === '/api/admin/calendar/disconnect') {
        requireMethod(request, 'POST');
        if (!oauth) fail(503, 'setup_required');
        if (!keys(await body(request, 128), [])) fail(400, 'invalid_field');
        if (path.endsWith('/disconnect')) {
          await oauth.disconnect();
          return json({ ok: true });
        }
        const flow = await oauth.start(sessionId(request));
        return json({ ok: true, authorizationUrl: flow.authorizationUrl }, 200, { 'Set-Cookie': flow.cookie });
      }

      if (path === '/api/admin/integrations') {
        requireMethod(request, 'GET');
        return json(await integrationView(time));
      }

      if (path === '/api/admin/state') {
        requireMethod(request, 'GET');
        const { lastSeen, snapshot, command } = await db.state(time, request.headers.get('x-desk-interactive') === '1');
        const age = lastSeen === null ? Infinity : time - lastSeen;
        return json({
          connection: age <= 75 ? 'online' : age <= 300 ? 'stale' : 'offline',
          lastSeenAt: lastSeen,
          status: snapshot?.status ?? null,
          config: snapshot?.config ?? null,
          github: snapshot?.github ?? null,
          command: publicCommand(command, time),
        });
      }

      if (path === '/api/admin/commands') {
        requireMethod(request, 'POST');
        const input = await body(request, 2048);
        if (!keys(input, ['id', 'type', 'payload']) || typeof input.id !== 'string' ||
            !ID.test(input.id)) fail(400, 'invalid_field');
        const payload = commandPayload(input.type, input.payload);
        if (!payload) fail(400, 'invalid_field');
        const command = {
          id: input.id, type: input.type, payload, state: 'queued', ack: null, delivered: false,
          createdAt: time, expiresAt: time + 90, queuedAtMs: nowMs(),
          fingerprint: sha256(JSON.stringify([input.type, payload])),
        };
        const result = await db.enqueue(command, time);
        if (result.state !== 'ok') fail(409, result.state);
        return json({ ok: true, command: publicCommand(result.command, time) }, 202);
      }

      const id = path.match(/^\/api\/admin\/commands\/([a-f0-9]{32})$/)?.[1];
      if (!id) fail(404, 'not_found');
      requireMethod(request, 'GET');
      const command = await db.command(id);
      if (!command) fail(404, 'not_found');
      return json({ ok: true, command: publicCommand(command, time) });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      const code = error instanceof HttpError ? error.message : 'unavailable';
      return json({ ok: false, error: { code, message: messages[code] } }, status, error.responseHeaders);
    }
  };
}
