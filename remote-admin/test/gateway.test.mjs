import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { passwordHash, randomHex, sha256 } from '../lib/auth.js';
import { createGateway } from '../lib/gateway.js';
import { redisClient, store } from '../lib/redis.js';

const origin = 'https://desk.thezah.space';
const password = randomHex(24);
const token = randomHex(32);
const bridgeToken = randomHex(32);
const payload = {
  status: {
    deviceName: 'ESP32 Display', mode: 'github', uptimeSeconds: 200, firmwareVersion: '1.0.1',
    wifi: { connected: true, ip: '192.168.1.2', hostname: 'private.local', password: 'ignored-fixture-value' },
    time: { synced: true, epochSeconds: 1794556800 },
    pomodoro: { phase: 'focus', state: 'idle', remainingSeconds: 1500, focusMinutes: 25, breakMinutes: 5 },
    github: { state: 'live', error: null, lastSync: '2026-11-13T08:00:00Z' },
  },
  config: {
    deviceName: 'ESP32 Display', githubUsername: 'octocat', githubProxyUrl: 'https://example.com/hidden',
    theme: 'dark', startupMode: 'github', clockShowSeconds: true,
    rotation: { enabled: false, intervalSeconds: 60, modes: ['github'] },
    message: { text: 'Hello', alignment: 'center', color: '#39D353', size: 2 },
  },
  github: {
    state: 'live', error: null, lastSync: '2026-11-13T08:00:00Z', username: 'octocat', levels: '0'.repeat(364),
    totalContributions: 0, currentStreak: 0, repositoryCount: 8,
  },
};

let redis;
let work;
let cli;
let env;
let now = 1794556800;
let app;

before(async () => {
  work = await mkdtemp(join(tmpdir(), 'desk-redis-'));
  const socket = join(work, 'r.sock');
  let startupError;
  redis = spawn(process.env.REDIS_SERVER ?? 'redis-server', [
    '--port', '0', '--unixsocket', socket, '--dir', work, '--save', '', '--appendonly', 'no',
  ], { stdio: 'ignore' });
  redis.on('error', (error) => { startupError = error; });
  cli = (...args) => {
    const output = execFileSync(process.env.REDIS_CLI ?? 'redis-cli', ['-s', socket, '--json', ...args.map(String)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(output);
  };
  for (let i = 0; i < 50; i++) {
    if (startupError) throw startupError;
    try {
      if (cli('PING') === 'PONG') break;
    } catch {
      if (i === 49) throw new Error('Redis did not start');
    }
    await delay(25);
  }

  env = {
    ADMIN_PASSWORD_HASH: await passwordHash(password), DEVICE_TOKEN_SHA256: sha256(token),
    UPSTASH_REDIS_REST_URL: 'https://local-redis.test', UPSTASH_REDIS_REST_TOKEN: 'fixture-storage-token',
  };
  app = gateway();
});

after(async () => {
  if (redis?.pid && redis.exitCode === null) {
    const done = new Promise((resolve) => redis.once('exit', resolve));
    redis.kill();
    await done;
  }
  if (work) await rm(work, { force: true, recursive: true });
});

function gateway(gatewayEnv = env, options = {}) {
  const exec = redisClient({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://local-redis.test');
      assert.equal(options.headers.authorization, 'Bearer fixture-storage-token');
      return Response.json({ result: cli(...JSON.parse(options.body)) });
    },
  });
  return createGateway({ env: gatewayEnv, storage: store(exec), now: () => now, nowMs: () => now * 1000 + 123, assets: async (name) => name, ...options });
}

const request = (path, { headers, data, base = origin, method } = {}) => new Request(base + path, {
  method: method ?? (data === undefined ? 'GET' : 'POST'),
  headers: data === undefined ? headers : { 'content-type': 'application/json', ...headers },
  body: data === undefined ? undefined : JSON.stringify(data),
});

async function expectError(res, status, code) {
  assert.equal(res.status, status);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal((await res.json()).error.code, code);
}

async function login(ip) {
  const response = await app(request('/api/auth/login', {
    data: { password }, headers: { origin, 'x-vercel-forwarded-for': ip },
  }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-smart-desk=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800$/);
  const auth = await response.json();
  assert.equal(auth.authenticated, true);
  assert.equal(auth.expiresAt, now + 28800);
  return { origin, cookie: cookie.split(';')[0], 'x-csrf-token': auth.csrfToken };
}

function sync({ nonce = randomHex(16), ts = now, ack = null, headers = {}, wantIntegrations, pollHints, snapshot = payload } = {}) {
  return app(request('/api/device/sync', { data: { v: 1, ts, nonce, ...snapshot, ack, wantIntegrations, pollHints },
    headers: { authorization: 'Bearer ' + token, ...headers } }));
}

test('setup is locked and alias GET/HEAD redirects without accepting mutations', async () => {
  const locked = createGateway({ env: { ADMIN_ORIGIN: 'ignored-fixture-value' } });
  assert.equal((await locked(request('/'))).status, 503);
  await expectError(await locked(request('/api/auth/session')), 503, 'setup_required');
  await expectError(await locked(request('/assets/index.html')), 503, 'setup_required');
  const alias = 'https://remote-alias.test';
  const redirected = await app(request('/api/auth/session', { base: alias, method: 'HEAD' }));
  assert.equal(redirected.status, 308);
  assert.equal(redirected.headers.get('location'), origin + '/api/auth/session');
  await expectError(await app(request('/api/auth/login', { base: alias, data: {} })), 403, 'forbidden');
  await expectError(await app(request('/api/admin/state')), 401, 'unauthorized');
  await expectError(await app(request('/app.js')), 401, 'unauthorized');
  await expectError(await app(request('/solana-devnet.png')), 401, 'unauthorized');
  assert.equal(await (await app(request('/'))).text(), 'login.html');
});

test('password KDF, strict cookie, CSRF, logout, session persistence and expiry', async () => {
  const loginPath = '/api/auth/login';
  await expectError(await app(request(loginPath, { data: { password } })), 403, 'forbidden');
  await expectError(await app(request(loginPath, { data: { password: 'wrong' }, headers: { origin } })), 401, 'invalid_credentials');
  const admin = await login('203.0.113.1');
  const reloaded = gateway();
  assert.equal(await (await reloaded(request('/', { headers: admin }))).text(), 'index.html');
  const walletQr = await reloaded(request('/solana-devnet.png', { headers: admin }));
  assert.equal(walletQr.headers.get('content-type'), 'image/png');
  assert.equal(await walletQr.text(), 'solana-devnet.png');
  assert.equal((await (await reloaded(request('/api/auth/session', { headers: admin }))).json()).authenticated, true);
  await expectError(await reloaded(request('/api/auth/logout', { data: {}, headers: { ...admin, origin: 'https://other.test' } })), 403, 'forbidden');
  await expectError(await reloaded(request('/api/auth/logout', { data: {}, headers: { ...admin, 'x-csrf-token': 'wrong' } })), 403, 'forbidden');
  const logout = await reloaded(request('/api/auth/logout', { data: {}, headers: admin }));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0$/);
  await expectError(await reloaded(request('/api/admin/state', { headers: admin })), 401, 'unauthorized');
  const expiring = await login('203.0.113.2');
  now += 28800;
  await expectError(await reloaded(request('/api/admin/state', { headers: expiring })), 401, 'unauthorized');
});

test('login rate limit is shared across gateway instances', async () => {
  const another = gateway();
  for (let i = 0; i < 7; i++) {
    const res = await (i % 2 ? another : app)(request('/api/auth/login', {
      data: { password: 'wrong' }, headers: { origin, 'x-vercel-forwarded-for': '203.0.113.8' },
    }));
    if (i === 6) {
      assert.ok(Number(res.headers.get('retry-after')) > 0);
      await expectError(res, 429, 'rate_limited');
    } else {
      await expectError(res, 401, 'invalid_credentials');
    }
  }
});

test('device snapshot, scoped credentials, replay, allowlist, durable queue and ACK', async () => {
  const admin = await login('203.0.113.9');
  const state = () => app(request('/api/admin/state', { headers: admin }));
  const create = (value) => app(request('/api/admin/commands', { data: value, headers: admin }));
  const id = randomHex(16);
  const command = { id, type: 'display', payload: { mode: 'clock' } };
  assert.equal((await (await state()).json()).connection, 'offline');
  await expectError(await create(command), 409, 'device_offline');
  await expectError(await sync({ headers: { authorization: 'Bearer ' + randomHex(32) } }), 401, 'unauthorized');
  await expectError(await sync({ headers: { origin } }), 403, 'forbidden');
  await expectError(await sync({ ts: now - 91 }), 409, 'invalid_device_time');
  const nonce = randomHex(16);
  assert.equal((await sync({ nonce })).status, 200);
  await expectError(await sync({ nonce }), 409, 'replay');
  const snapshot = await (await state()).json();
  assert.equal(snapshot.connection, 'online');
  assert.equal(snapshot.status.wifi.ip, null);
  assert.equal(snapshot.status.wifi.hostname, null);
  assert.equal(snapshot.config.githubProxyUrl, undefined);
  assert.equal(snapshot.status.wifi.password, undefined);
  await expectError(await create({ ...command, type: 'restart', payload: { confirm: true } }), 400, 'invalid_field');
  await expectError(await create({ ...command, type: 'config', payload: { githubProxyUrl: 'https://other.test' } }), 400, 'invalid_field');
  const results = await Promise.all([create(command), create(command)]);
  for (const res of results) assert.equal(res.status, 202);
  await expectError(await create({ ...command, payload: { mode: 'stats' } }), 409, 'id_conflict');
  await expectError(await create({ ...command, id: randomHex(16) }), 409, 'command_pending');
  const ack = { id, result: 'applied', code: null };
  const first = await (await sync({ ack })).json();
  assert.equal(first.ackId, null);
  assert.deepEqual(first.command, { ...command, createdAt: now, expiresAt: now + 90 });
  assert.equal((await (await sync()).json()).command.id, id);
  const acked = await (await sync({ ack })).json();
  assert.equal(acked.ackId, id);
  assert.equal(acked.command, null);
  assert.equal((await (await sync({ ack: { ...ack, result: 'rejected' } })).json()).ackId, id);
  const lookup = await gateway()(request('/api/admin/commands/' + id, { headers: admin }));
  assert.equal((await lookup.json()).command.state, 'applied');

  const next = { ...command, id: randomHex(16), payload: { mode: 'solana' } };
  const wallet = { ...payload, status: { ...payload.status, solanaWallet: true, mode: 'solana' },
    config: { ...payload.config, startupMode: 'solana' } };
  assert.equal((await sync({ snapshot: wallet })).status, 200);
  const walletState = await (await state()).json();
  assert.equal(walletState.status.solanaWallet, true);
  assert.equal(walletState.status.mode, 'solana');
  assert.equal(walletState.config.startupMode, 'solana');
  assert.equal((await create(next)).status, 202);
  now += 76;
  assert.equal((await (await state()).json()).connection, 'stale');
  now += 14;
  assert.equal((await (await state()).json()).command.state, 'expired');
  assert.equal((await (await sync()).json()).command, null);
  now += 301;
  assert.equal((await (await state()).json()).connection, 'offline');
});

test('retired quota bridges reject uploads and old clients still receive Calendar', async () => {
  const legacyEnv = { ...env, CODEX_BRIDGE_TOKEN_SHA256: sha256(bridgeToken), CLAUDE_BRIDGE_TOKEN_SHA256: sha256(bridgeToken) };
  const legacyGateway = gateway(legacyEnv);
  for (const provider of ['codex', 'claude']) {
    const response = await legacyGateway(request('/api/bridge/quota/' + provider, {
      data: {}, headers: { authorization: 'Bearer ' + bridgeToken },
    }));
    await expectError(response, 404, 'not_found');
    await cli('SET', 'smart-desk:remote:v1:quota:' + provider, '{}', 'EX', 86400);
  }
  await expectError(await app(request('/api/admin/integrations')), 401, 'unauthorized');
  const admin = await login('203.0.113.12');
  const fromAdmin = await (await app(request('/api/admin/integrations', { headers: admin }))).json();
  assert.equal((await (await sync()).json()).integrations, undefined);
  const fromDevice = (await (await sync({ wantIntegrations: true })).json()).integrations;
  assert.deepEqual(fromAdmin, fromDevice);
  assert.equal(fromDevice.calendar.state, 'unavailable');
  for (const provider of ['codex', 'claude']) {
    const slot = fromDevice.quotas[provider];
    assert.equal(slot.state, 'unavailable');
    assert.deepEqual(slot.windows, []);
    assert.equal(slot.observedAt, null);
  }
});

test('six-digit PIN preserves leading zero and shares per-IP and global Redis limits', async () => {
  // This Redis instance is private to the test file. Start with a fresh rate-limit window.
  assert.equal(cli('FLUSHDB'), 'OK');
  const pin = '047352';
  const pinEnv = { ...env, ADMIN_PASSWORD_HASH: await passwordHash(pin) };
  const gateways = [gateway(pinEnv), gateway(pinEnv)];
  const attempt = (instance, ip, value) => gateways[instance](request('/api/auth/login', {
    data: { password: value }, headers: { origin, 'x-vercel-forwarded-for': ip },
  }));

  const correct = await attempt(0, '203.0.113.20', pin);
  assert.equal(correct.status, 200);
  assert.equal((await correct.json()).authenticated, true);
  assert.match(correct.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);

  for (let i = 0; i < 6; i++) {
    await expectError(await attempt(i % 2, '203.0.113.21', pin.slice(1)), 401, 'invalid_credentials');
  }
  const blockedIp = await attempt(1, '203.0.113.21', pin);
  assert.ok(Number(blockedIp.headers.get('retry-after')) > 0);
  await expectError(blockedIp, 429, 'rate_limited');

  for (let i = 0; i < 23; i++) {
    await expectError(await attempt(i % 2, `203.0.113.${30 + i}`, '047351'), 401, 'invalid_credentials');
  }
  const blockedGlobal = await attempt(0, '203.0.113.80', pin);
  assert.ok(Number(blockedGlobal.headers.get('retry-after')) > 0);
  await expectError(blockedGlobal, 429, 'rate_limited');
});

test('active admin leases fast polling with a Redis budget and command timestamps', async () => {
  assert.equal(cli('FLUSHDB'), 'OK');
  const admin = await login('203.0.113.90');
  const deskState = () => app(request('/api/admin/state', {
    headers: { ...admin, 'x-desk-interactive': '1' },
  }));
  assert.equal((await deskState()).status, 200);
  assert.equal((await (await sync()).json()).pollAfterMs, undefined);
  assert.equal((await (await sync({ pollHints: true })).json()).pollAfterMs, 60000);
  assert.equal((await deskState()).status, 200);
  assert.equal((await (await sync({ pollHints: true })).json()).pollAfterMs, 3000);
  const id = randomHex(16);
  const created = await (await app(request('/api/admin/commands', { headers: admin,
    data: { id, type: 'display', payload: { mode: 'clock' } } }))).json();
  assert.equal(created.command.queuedAtMs, now * 1000 + 123);
  now++;
  assert.deepEqual(Object.keys((await (await sync()).json()).command).sort(),
    ['createdAt', 'expiresAt', 'id', 'payload', 'type']);
  now++;
  assert.equal((await (await sync({ ack: { id, result: 'applied', code: null } })).json()).ackId, id);
  const { command } = await (await app(request('/api/admin/commands/' + id, { headers: admin }))).json();
  assert.equal(command.deliveredAtMs - command.queuedAtMs, 1000);
  assert.equal(command.acknowledgedAtMs - command.deliveredAtMs, 1000);
  cli('DEL', 'smart-desk:remote:v1:interactive');
  cli('SET', 'smart-desk:remote:v1:interactive:' + Math.floor(now / 86400), '1800', 'EX', '1000');
  assert.equal((await deskState()).status, 200);
  assert.equal((await (await sync()).json()).pollAfterMs, undefined);
});

test('Google OAuth binds one-time state to a live admin session and encrypts the grant', async () => {
  const googleEnv = { ...env, GOOGLE_CALENDAR_CLIENT_ID: 'fixture-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret', GOOGLE_CALENDAR_TOKEN_KEY: randomHex(32) };
  const grantToken = 'fixture-only-google-refresh';
  let exchangeCount = 0;
  let revokeCount = 0;
  const google = gateway(googleEnv, { fetchGoogle: async (url, options) => {
    if (new URL(url).pathname === '/revoke') {
      revokeCount++;
      assert.equal(options.body.get('token'), grantToken);
      return new Response(null);
    }
    assert.equal(options.body.get('grant_type'), 'authorization_code');
    assert.ok(options.body.get('code_verifier'));
    exchangeCount++;
    return Response.json({ scope: 'https://www.googleapis.com/auth/calendar.events.owned.readonly', refresh_token: grantToken });
  } });
  const admin = await login('203.0.113.91');
  const connectPath = '/api/admin/calendar/connect';
  await expectError(await google(request(connectPath, { data: {} })), 401, 'unauthorized');
  await expectError(await google(request(connectPath, { data: {},
    headers: { ...admin, 'x-csrf-token': 'invalid' } })), 403, 'forbidden');
  const start = await google(request(connectPath, { data: {}, headers: admin }));
  assert.equal(start.status, 200);
  const callbackCookie = start.headers.get('set-cookie');
  assert.match(callbackCookie, /Secure; HttpOnly; SameSite=Lax/);
  const { authorizationUrl } = await start.json();
  const googleUrl = new URL(authorizationUrl);
  assert.equal(googleUrl.origin, 'https://accounts.google.com');
  assert.equal(googleUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(googleUrl.searchParams.get('redirect_uri'), origin + '/api/auth/google/callback');
  const path = '/api/auth/google/callback?state=' + googleUrl.searchParams.get('state') + '&code=fixture';
  const rejected = await google(request(path, { headers: admin }));
  assert.equal(rejected.headers.get('location'), '/?calendar=failed#calendar');
  const callback = () => google(request(path, { headers: { cookie: callbackCookie.split(';')[0] } }));
  const success = await callback();
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), '/?calendar=connected#calendar');
  assert.equal((await callback()).headers.get('location'), '/?calendar=failed#calendar');
  assert.equal(exchangeCount, 1);
  const stored = cli('GET', 'smart-desk:remote:v1:calendar:oauth-grant');
  assert.equal(typeof JSON.parse(stored).sealed, 'string');
  assert.ok(!stored.includes(grantToken));
  assert.equal((await google(request('/api/admin/calendar/disconnect', { data: {}, headers: admin }))).status, 200);
  assert.equal(revokeCount, 1);
  assert.equal(cli('GET', 'smart-desk:remote:v1:calendar:oauth-grant'), null);
});
