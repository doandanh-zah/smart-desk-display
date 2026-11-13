import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const canonical = 'https://desk.thezah.space';
const alias = 'https://smart-desk-remote-admin.vercel.app';
const mode = process.argv[2];
assert.ok(['locked', 'active'].includes(mode), 'Usage: node scripts/smoke-production.mjs locked|active');
const locked = mode === 'locked';

async function check(origin, path, status, init = {}) {
  const response = await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(8000), ...init });
  assert.equal(response.status, status, origin + path);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/, path);
  assert.equal(response.headers.get('access-control-allow-origin'), null, path);
  assert.equal(response.headers.get('set-cookie'), null, path);
  console.log(`${init.method ?? 'GET'} ${origin}${path} → ${status}`);
  return response;
}

const home = await check(canonical, '/', locked ? 503 : 200);
const homeHtml = await home.text();
assert.match(homeHtml, locked ? /chưa được thiết lập/i : /id="auth-form"/);
assert.doesNotMatch(homeHtml, /id="mode-list"/);

const session = await check(canonical, '/api/auth/session', locked ? 503 : 200);
if (locked) assert.equal((await session.json()).error.code, 'setup_required');
else assert.deepEqual(await session.json(), { authenticated: false });

const state = await check(canonical, '/api/admin/state', locked ? 503 : 401);
assert.equal((await state.json()).error.code, locked ? 'setup_required' : 'unauthorized');
const device = await check(canonical, '/api/device/sync', locked ? 503 : 401, { method: 'POST' });
assert.equal((await device.json()).error.code, locked ? 'setup_required' : 'unauthorized');

await check(canonical, '/app.js', locked ? 503 : 401);
const staticPath = await check(canonical, '/dashboard/index.html', locked ? 503 : 404);
assert.doesNotMatch(await staticPath.text(), /id="mode-list"/);
const redirected = await check(alias, '/api/auth/session', 308);
assert.equal(redirected.headers.get('location'), canonical + '/api/auth/session');
await check(alias, '/api/auth/login', 403, { method: 'POST' });

if (!locked) {
  const crossSite = await check(canonical, '/api/auth/login', 403, {
    method: 'POST', headers: { origin: 'https://other.invalid', 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal((await crossSite.json()).error.code, 'forbidden');

  const staged = process.argv[3];
  if (staged) {
    for (const name of ['styles.css', 'zah-avatar.webp']) {
      const asset = await check(canonical, '/' + name, 200);
      const expected = await readFile(join(staged, name));
      assert.deepEqual(Buffer.from(await asset.arrayBuffer()), expected, name + ' byte identity');
    }
  }
}
