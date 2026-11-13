export const ID = /^[a-f0-9]{32}$/;
export const TOKEN = /^[a-f0-9]{64}$/;
const CODE = /^[a-z0-9_]{1,48}$/;
const CONTROL_MODES = ['github', 'clock', 'stats', 'pomodoro', 'message', 'countdown'];
const MODES = [...CONTROL_MODES, 'codex', 'claude'];
const THEMES = ['dark', 'light'];
const ALIGNMENTS = ['left', 'center', 'right'];

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
export const keys = (value, required, optional = []) => object(value) &&
  required.every((name) => Object.hasOwn(value, name)) &&
  Object.keys(value).every((name) => required.includes(name) || optional.includes(name));
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const text = (value, max, pattern) => typeof value === 'string' && value.length <= max && pattern.test(value);
const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value);
const flag = (value) => typeof value === 'boolean';
const nullable = (value, check) => value === null || check(value);

function message(value) {
  if (!keys(value, ['text', 'alignment', 'color', 'size']) ||
      !text(value.text, 160, /^[ -~\n]*$/) || !ALIGNMENTS.includes(value.alignment) ||
      !text(value.color, 7, /^#[0-9A-Fa-f]{6}$/) || !integer(value.size, 1, 4)) return null;
  return { text: value.text, alignment: value.alignment, color: value.color.toUpperCase(), size: value.size };
}

function rotation(value, modes = MODES) {
  if (!keys(value, ['enabled', 'intervalSeconds', 'modes']) || !flag(value.enabled) ||
      !integer(value.intervalSeconds, 30, 600) || !Array.isArray(value.modes) ||
      value.modes.length < (value.enabled ? 2 : 1) || value.modes.length > 5 ||
      !value.modes.every((mode) => modes.includes(mode)) ||
      new Set(value.modes).size !== value.modes.length) return null;
  return { enabled: value.enabled, intervalSeconds: value.intervalSeconds, modes: value.modes };
}

export function commandPayload(type, payload) {
  if (type === 'display' && keys(payload, ['mode']) && CONTROL_MODES.includes(payload.mode)) {
    return { mode: payload.mode };
  }
  if (type === 'countdown') {
    if (keys(payload, ['action']) && ['start', 'pause', 'reset'].includes(payload.action)) {
      return { action: payload.action };
    }
    if (payload?.action !== 'configure') return null;
    if (payload.kind === 'duration' && keys(payload, ['action', 'kind', 'durationSeconds']) &&
        integer(payload.durationSeconds, 1, 359999)) {
      return { action: payload.action, kind: payload.kind, durationSeconds: payload.durationSeconds };
    }
    if (payload.kind === 'target' && keys(payload, ['action', 'kind', 'targetEpochSeconds']) &&
        integer(payload.targetEpochSeconds, 1704067200, 4102444799)) {
      return { action: payload.action, kind: payload.kind, targetEpochSeconds: payload.targetEpochSeconds };
    }
    return null;
  }
  if (type === 'message') return message(payload);
  if (type === 'pomodoro' && keys(payload, ['action']) &&
      ['start', 'pause', 'reset'].includes(payload.action)) return { action: payload.action };
  if (type !== 'config' || !keys(payload, [], ['theme', 'clockShowSeconds', 'rotation']) ||
      Object.keys(payload).length === 0) return null;
  const config = {};
  if (Object.hasOwn(payload, 'theme')) {
    if (!THEMES.includes(payload.theme)) return null;
    config.theme = payload.theme;
  }
  if (Object.hasOwn(payload, 'clockShowSeconds')) {
    if (!flag(payload.clockShowSeconds)) return null;
    config.clockShowSeconds = payload.clockShowSeconds;
  }
  if (Object.hasOwn(payload, 'rotation')) {
    config.rotation = rotation(payload.rotation, CONTROL_MODES);
    if (!config.rotation) return null;
  }
  return config;
}

function pomodoro(value) {
  if (!object(value) || !['focus', 'break'].includes(value.phase) ||
      !['idle', 'running', 'paused', 'completed'].includes(value.state) ||
      !integer(value.remainingSeconds, 0, 86400) || !integer(value.focusMinutes, 1, 1440) ||
      !integer(value.breakMinutes, 1, 1440)) return null;
  return { phase: value.phase, state: value.state, remainingSeconds: value.remainingSeconds,
    focusMinutes: value.focusMinutes, breakMinutes: value.breakMinutes };
}

const githubStates = ['demo', 'loading', 'live', 'stale', 'error'];
function githubSync(value) {
  if (!object(value) || !githubStates.includes(value.state) ||
      !nullable(value.lastSync, isoDate) || !nullable(value.error, (v) => text(v, 48, CODE))) return null;
  return { state: value.state, lastSync: value.lastSync, error: value.error };
}

function countdown(value) {
  if (!keys(value, ['kind', 'state', 'durationSeconds', 'targetEpochSeconds', 'remainingSeconds']) ||
      !['duration', 'target'].includes(value.kind) ||
      !['idle', 'running', 'paused', 'completed', 'waiting_for_time'].includes(value.state) ||
      !integer(value.durationSeconds, 1, 359999) ||
      !nullable(value.remainingSeconds, (v) => integer(v, 0, 4102444799))) return null;
  if (value.kind === 'duration' ? value.targetEpochSeconds !== null :
      !integer(value.targetEpochSeconds, 1704067200, 4102444799)) return null;
  const { kind, state, durationSeconds, targetEpochSeconds, remainingSeconds } = value;
  return { kind, state, durationSeconds, targetEpochSeconds, remainingSeconds };
}

function deviceStatus(value) {
  if (!object(value) || !text(value.deviceName, 32, /^[a-zA-Z0-9][a-zA-Z0-9 -]*$/) ||
      !MODES.includes(value.mode) || !object(value.wifi) || !flag(value.wifi.connected) ||
      !integer(value.uptimeSeconds, 0, 0xffffffff) || !text(value.firmwareVersion, 32, /^[a-zA-Z0-9.+-]+$/) ||
      !object(value.time) || !flag(value.time.synced) ||
      !nullable(value.time.epochSeconds, (v) => integer(v, 0, Number.MAX_SAFE_INTEGER))) return null;
  const timer = pomodoro(value.pomodoro);
  const github = githubSync(value.github);
  const counter = value.countdown === undefined ? null : countdown(value.countdown);
  if (!timer || !github || (value.countdown !== undefined && !counter)) return null;
  return { deviceName: value.deviceName, mode: value.mode, uptimeSeconds: value.uptimeSeconds,
    firmwareVersion: value.firmwareVersion, wifi: { connected: value.wifi.connected, ip: null, hostname: null, provisioning: false },
    time: { synced: value.time.synced, epochSeconds: value.time.epochSeconds, timezone: 'Asia/Ho_Chi_Minh', utcOffsetMinutes: 420 },
    github, pomodoro: timer, ...(counter ? { countdown: counter } : {}) };
}

function deviceConfig(value) {
  if (!object(value) || !text(value.deviceName, 32, /^[a-zA-Z0-9][a-zA-Z0-9 -]*$/) ||
      !text(value.githubUsername, 39, /^(?:[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*)?$/) ||
      !THEMES.includes(value.theme) || !MODES.includes(value.startupMode) ||
      !flag(value.clockShowSeconds)) return null;
  const modes = rotation(value.rotation);
  const custom = message(value.message);
  if (!modes || !custom) return null;
  return { deviceName: value.deviceName, githubUsername: value.githubUsername,
    theme: value.theme, startupMode: value.startupMode, clockShowSeconds: value.clockShowSeconds,
    rotation: modes, message: custom };
}

function deviceGithub(value) {
  const base = githubSync(value);
  if (!base || !text(value.username, 39, /^[a-zA-Z0-9-]*$/) ||
      !text(value.levels, 364, /^(?:[0-4]{364})?$/) ||
      !nullable(value.totalContributions, (v) => integer(v, 0, 0xffffffff)) ||
      !nullable(value.currentStreak, (v) => integer(v, 0, 364)) ||
      !nullable(value.repositoryCount, (v) => integer(v, 0, 0x7fffffff))) return null;
  const usable = ['demo', 'live', 'stale'].includes(base.state);
  if (usable !== (value.levels.length === 364) ||
      usable !== (value.totalContributions !== null && value.currentStreak !== null)) return null;
  return { ...base, username: value.username, levels: value.levels, totalContributions: value.totalContributions,
    currentStreak: value.currentStreak, repositoryCount: value.repositoryCount };
}

export function syncRequest(body) {
  if (!keys(body, ['v', 'ts', 'nonce', 'status', 'config', 'github', 'ack'], ['wantIntegrations', 'pollHints']) || body.v !== 1 ||
      !integer(body.ts, 0, Number.MAX_SAFE_INTEGER) || !text(body.nonce, 32, ID)) return null;
  if (Object.hasOwn(body, 'wantIntegrations') && !flag(body.wantIntegrations)) return null;
  if (Object.hasOwn(body, 'pollHints') && !flag(body.pollHints)) return null;
  const ack = body.ack;
  if (ack !== null && (!keys(ack, ['id', 'result', 'code']) || !text(ack.id, 32, ID) ||
      !['applied', 'rejected'].includes(ack.result) || !nullable(ack.code, (v) => text(v, 48, CODE)))) return null;
  const status = deviceStatus(body.status);
  const config = deviceConfig(body.config);
  const github = deviceGithub(body.github);
  if (!status || !config || !github) return null;
  return { nonce: body.nonce, ts: body.ts, snapshot: { status, config, github }, ack, wantIntegrations: body.wantIntegrations === true, pollHints: body.pollHints === true };
}
