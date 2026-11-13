import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import endpoint from '../api/contributions.js';
import { createHandler } from '../lib/handler.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/contributions.json', import.meta.url)));
const at = new Date('2026-11-13T15:00:00Z');
const get = (username = 'octocat') =>
  new Request(`https://proxy.test/api/contributions?username=${encodeURIComponent(username)}`);

function fixtureHandler(fetchImpl = async () => Response.json(fixture), now = () => at) {
  return createHandler({ fetchImpl, now, getToken: () => 'fake-fixture-token' });
}

async function checkError(response, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: code });
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

test('exports a Vercel fetch entry and compacts the real GraphQL field shape', async () => {
  assert.equal(typeof endpoint.fetch, 'function');
  const handle = fixtureHandler(async (url, options) => {
    assert.equal(url, 'https://api.github.com/graphql');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer fake-fixture-token');
    const { query, variables } = JSON.parse(options.body);
    assert.match(query, /contributionDays \{ date contributionCount contributionLevel color \}/);
    assert.match(query, /privacy: PUBLIC, ownerAffiliations: \[OWNER\]/);
    assert.deepEqual(variables, {
      login: 'octocat',
      from: '2025-11-16T00:00:00.000Z',
      to: '2026-11-13T15:00:00.000Z',
    });
    return Response.json(fixture);
  });

  const response = await handle(get('OcToCaT'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'public, max-age=300');
  assert.deepEqual(await response.json(), {
    v: 1,
    username: 'Octocat',
    start: '2025-11-16',
    asOf: '2026-11-13',
    levels: `1${'0'.repeat(355)}20103400`,
    total: 22,
    streak: 2,
    repos: 8,
  });
});

test('UTC Saturday-to-Sunday boundary shifts the window and resets cache', async () => {
  let now = new Date('2026-11-14T23:59:58Z');
  let calls = 0;
  const handle = fixtureHandler(async () => {
    calls++;
    return Response.json(fixture);
  }, () => now);
  const saturday = await handle(get());
  assert.equal(saturday.headers.get('vercel-cdn-cache-control'), 'public, max-age=2');
  assert.equal((await saturday.json()).streak, 1);

  now = new Date('2026-11-15T00:00:01Z');
  const sunday = await (await handle(get())).json();
  assert.equal(sunday.start, '2025-11-23');
  assert.equal(sunday.asOf, '2026-11-15');
  assert.equal(sunday.levels.slice(-7), '0000000');
  assert.equal(sunday.total, 22);
  assert.equal(sunday.streak, 1);
  assert.equal(calls, 2);
});

test('coalesces case-insensitive requests and expires the process cache', async () => {
  let calls = 0;
  let now = at;
  const handle = fixtureHandler(async () => {
    calls++;
    return Response.json(fixture);
  }, () => now);
  const [first, second] = await Promise.all([handle(get()), handle(get('OCTOCAT'))]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await handle(get())).status, 200);
  assert.equal(calls, 1);
  now = new Date(at.getTime() + 300_001);
  assert.equal((await handle(get())).status, 200);
  assert.equal(calls, 2);
});

test('rejects malformed handles, duplicate parameters and unsupported methods', async () => {
  let calls = 0;
  const handle = fixtureHandler(async () => { calls++; });
  for (const name of ['', '--a', 'a--b', 'x-','-x', 'a/b', 'a\n', 'a'.repeat(40)]) {
    await checkError(await handle(get(name)), 400, 'invalid_username');
  }
  await checkError(await handle(new Request(`${get().url}&username=other`)), 400, 'invalid_username');
  const post = await handle(new Request(get().url, { method: 'POST' }));
  assert.equal(post.headers.get('allow'), 'GET');
  await checkError(post, 405, 'method_not_allowed');
  assert.equal(calls, 0);
});

test('fails closed when the token is missing and maps GitHub user lookup errors', async () => {
  const noToken = createHandler({ getToken: () => '' });
  await checkError(await noToken(get()), 503, 'proxy_unconfigured');
  const unknownUser = fixtureHandler(async () => Response.json({
    data: { user: null },
    errors: [{ type: 'NOT_FOUND', path: ['user'], message: 'private upstream details' }],
  }));
  await checkError(await unknownUser(get()), 404, 'user_not_found');
});

test('keeps a valid calendar when repository count is unavailable', async () => {
  const payload = structuredClone(fixture);
  payload.data.user.repositories = null;
  payload.errors = [{ path: ['user', 'repositories'], message: 'optional field failed' }];
  const response = await fixtureHandler(async () => Response.json(payload))(get());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).repos, null);
});

test('rejects malformed calendars and sanitizes upstream failures and timeouts', async () => {
  const payload = structuredClone(fixture);
  payload.data.user.contributionsCollection.contributionCalendar.weeks[0].contributionDays[0].date =
    '2026-02-30';
  const invalid = fixtureHandler(async () => Response.json(payload));
  await checkError(await invalid(get()), 502, 'upstream_error');
  const failure = fixtureHandler(async () => Response.json({ message: 'upstream detail' }, { status: 401 }));
  await checkError(await failure(get()), 502, 'upstream_error');
  const timeout = fixtureHandler(async () => { throw new DOMException('upstream detail', 'TimeoutError'); });
  await checkError(await timeout(get()), 504, 'upstream_timeout');
});

test('normalizes GraphQL rate limits and gates new cache misses until reset', async () => {
  let calls = 0;
  let now = at;
  const reset = at.getTime() / 1000 + 80;
  const handle = fixtureHandler(async () => {
    calls++;
    if (calls > 1) return Response.json(fixture);
    return Response.json({ errors: [{ type: 'RATE_LIMITED' }] }, {
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    });
  }, () => now);

  const limited = await handle(get());
  assert.equal(limited.headers.get('retry-after'), '80');
  await checkError(limited, 429, 'rate_limited');
  now = new Date(at.getTime() + 1_000);
  const other = await handle(get('other'));
  assert.equal(other.headers.get('retry-after'), '79');
  await checkError(other, 429, 'rate_limited');
  assert.equal(calls, 1);
  now = new Date(reset * 1000);
  assert.equal((await handle(get())).status, 200);
  assert.equal(calls, 2);
});

test('preserves an HTTP Retry-After date and does not cache the error', async () => {
  const retry = new Date(at.getTime() + 25_000).toUTCString();
  const handle = fixtureHandler(async () =>
    new Response(null, { status: 403, headers: { 'Retry-After': retry } }));
  const response = await handle(get());
  assert.equal(response.headers.get('retry-after'), '25');
  await checkError(response, 429, 'rate_limited');
});
