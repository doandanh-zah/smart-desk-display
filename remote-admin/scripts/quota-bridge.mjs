import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { codexCredits, normalizeQuota } from '../lib/integrations.js';

const origin = 'https://desk.thezah.space';
const seconds = () => Math.floor(Date.now() / 1000);

export function claudeSample(input, observedAt) {
  const windows = [];
  for (const [id, windowMinutes] of [['five_hour', 300], ['seven_day', 10080]]) {
    const window = input?.rate_limits?.[id];
    if (!Number.isFinite(window?.used_percentage) || (window.resets_at && window.resets_at <= observedAt)) continue;
    windows.push({ id, windowMinutes, usedPercent: window.used_percentage, resetsAt: window.resets_at ?? null });
  }
  return normalizeQuota('claude', { observedAt, state: windows.length ? 'live' : 'unavailable', windows });
}

export async function codexSample(command = 'codex') {
  const child = spawn(command, ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  const deadline = setTimeout(() => child.kill(), 10000);
  const finish = () => { for (const { reject } of pending.values()) reject(new Error('codex_app_server_unavailable')); };
  child.on('error', finish);
  child.stdin.on('error', finish);
  lines.on('close', finish);
  lines.on('line', (line) => {
    let data;
    try { data = JSON.parse(line); } catch { return; }
    const match = pending.get(data?.id);
    if (!match || (!Object.hasOwn(data, 'result') && !Object.hasOwn(data, 'error'))) return;
    pending.delete(data.id);
    if (data.error) match.reject(new Error('codex_app_server_rpc_failed'));
    else match.resolve(data.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'smart_desk_display', title: 'Smart Desk Display', version: '1.0.0' } });
    child.stdin.write('{"method":"initialized"}\n');
    const { account } = await rpc('account/read', { refreshToken: false });
    if (!account || account.type !== 'chatgpt') {
      return normalizeQuota('codex', { observedAt: seconds(), state: account ? 'unsupported' : 'unavailable', windows: [] });
    }
    const result = await rpc('account/rateLimits/read');
    const bucket = result.rateLimitsByLimitId?.codex ??
      (result.rateLimits?.limitId === 'codex' ? result.rateLimits : null);
    const observedAt = seconds();
    const windows = ['primary', 'secondary'].flatMap((id) => {
      const window = bucket?.[id];
      if (!Number.isFinite(window?.usedPercent) || (window.resetsAt && window.resetsAt <= observedAt)) return [];
      return [{ id, usedPercent: window.usedPercent, windowMinutes: window.windowDurationMins ?? null,
        resetsAt: window.resetsAt ?? null }];
    });
    const credits = codexCredits(bucket, result.rateLimitResetCredits, observedAt);
    return normalizeQuota('codex', { observedAt, state: windows.length || credits.credit || credits.resetCredits
      ? 'live' : 'unavailable', windows, ...credits });
  } finally {
    clearTimeout(deadline);
    lines.close();
    child.kill();
  }
}

async function publish(provider, sample) {
  const directory = process.env.SMART_DESK_BRIDGE_TOKEN_DIR;
  if (!directory || !isAbsolute(directory)) throw new Error('bridge_token_directory_required');
  const path = join(directory, provider + '.token');
  const file = await stat(path);
  if (!file.isFile() || (file.mode & 0o077) !== 0) throw new Error('bridge_token_permissions');
  const token = (await readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('bridge_token_invalid');
  const response = await fetch(origin + '/api/bridge/quota/' + provider, {
    method: 'POST', redirect: 'error',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(sample), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('bridge_http_' + response.status);
}

export async function main([provider, flag]) {
  if (!['codex', 'claude'].includes(provider) || (flag && flag !== '--publish')) {
    throw new Error('Usage: node quota-bridge.mjs codex|claude [--publish]');
  }
  let sample;
  if (provider === 'codex') {
    sample = await codexSample();
  } else {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 1_048_576) throw new Error('statusline_input_too_large');
    }
    sample = claudeSample(JSON.parse(raw), seconds());
  }
  if (!sample) throw new Error('quota_payload_invalid');
  if (flag === '--publish' && sample.state !== 'unavailable') await publish(provider, sample);
  if (provider === 'claude' && flag === '--publish') {
    console.log(sample.windows.map((w) => `${w.id === 'five_hour' ? '5h' : '7d'} ${w.usedPercent}%`).join(' · '));
  } else {
    console.log(JSON.stringify(sample));
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    // Fetch and parse errors may contain input details. Print only stable status.
    const code = /^(?:bridge_[a-z0-9_]+|codex_app_server_[a-z_]+|statusline_input_too_large|quota_payload_invalid)$/.test(error.message)
      ? error.message : 'source_unavailable';
    console.error(code);
    process.exitCode = 1;
  }
}
