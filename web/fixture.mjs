import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const modes = ["github", "clock", "stats", "pomodoro", "message"];
const config = {
  deviceName: "Smart Desk Fixture",
  githubUsername: "",
  githubProxyUrl: "",
  theme: "dark",
  startupMode: "github",
  clockShowSeconds: true,
  rotation: { enabled: false, intervalSeconds: 60, modes: [...modes] },
  message: { text: "Hello, developer!", alignment: "center", color: "#39D353", size: 2 },
};
const timer = { phase: "focus", state: "idle", remainingSeconds: 1500, focusMinutes: 25, breakMinutes: 5 };
const githubScenarios = new Set(["live", "stale", "error", "loading"]);
const scenarios = new Set(["demo", ...githubScenarios, "unsynced", "reject", "offline", "modes-v2"]);
const scenario = process.env.FIXTURE_SCENARIO || "demo";
const versionTwo = scenario === "modes-v2";
if (versionTwo) {
  modes.push("countdown");
  config.rotation.modes = ["github", "clock", "countdown"];
}
let countdown = { kind: "duration", state: "idle", durationSeconds: 1500, targetEpochSeconds: null, remainingSeconds: 1500 };
let countdownEnds;
const port = Number(process.env.PORT || 4173);
if (!scenarios.has(scenario)) throw new Error(`Unknown FIXTURE_SCENARIO: ${scenario}`);

const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/styles.css", ["styles.css", "text/css"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/preview.js", ["preview.js", "text/javascript"]],
  ["/transport.js", ["transport.js", "text/javascript"]],
  ["/zah-avatar.webp", ["zah-avatar.webp", "image/webp"]],
]);
let startedAt = performance.now();
let rotationAt = startedAt;
let restartAt = null;
let timerEndsAt = null;
let timeSynced = scenario !== "unsynced";
let mode = config.startupMode;

function reply(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function failure(res, status, code, message, field) {
  reply(res, status, { ok: false, error: { code, message, field } });
}

function ok(res, data) {
  reply(res, 200, { ok: true, ...data });
}

function sync(now) {
  if (timer.state === "running") {
    timer.remainingSeconds = Math.max(0, Math.ceil((timerEndsAt - now) / 1000));
    if (!timer.remainingSeconds) timer.state = "completed";
  }
  if (config.rotation.enabled) {
    const interval = config.rotation.intervalSeconds * 1000;
    const steps = Math.floor((now - rotationAt) / interval);
    if (steps > 0) {
      const rotation = config.rotation.modes;
      const current = rotation.indexOf(mode);
      mode = rotation[(current + steps) % rotation.length];
      rotationAt += steps * interval;
    }
  }
}

const demoLevels = Array.from({ length: 364 }, (_, i) => {
  const n = ((i + 7) * (i + 11) * 17 + (i >> 3) * 13) % 53;
  return n < 26 ? 0 : n < 36 ? 1 : n < 44 ? 2 : n < 50 ? 3 : 4;
}).join("");

function githubData() {
  const configured = config.githubUsername && config.githubProxyUrl;
  const state = githubScenarios.has(scenario) ? scenario : configured ? "error" : "demo";
  const synced = state === "live" || state === "stale";
  const usable = synced || state === "demo";
  return {
    state,
    username: state === "demo" ? "demo" : config.githubUsername || "fixture",
    lastSync: synced ? "2026-10-28T03:20:00Z" : null,
    error: state === "error" ? "tls_verification_failed" : state === "stale" ? "upstream_timeout" : null,
    totalContributions: usable ? [...demoLevels].reduce((sum, level) => sum + Number(level), 0) : null,
    currentStreak: usable ? 3 : null,
    repositoryCount: synced ? 12 : null,
    levels: usable ? demoLevels : "",
  };
}

function countdownSample(now) {
  if (countdown.state === "running") {
    countdown.remainingSeconds = countdown.kind === "target"
      ? Math.max(0, countdown.targetEpochSeconds - Math.floor(Date.now() / 1000))
      : Math.max(0, Math.ceil((countdownEnds - now) / 1000));
    if (!countdown.remainingSeconds) countdown.state = "completed";
  }
  return countdown;
}

function calendar() {
  const now = Math.floor(Date.now() / 1000);
  return {
    source: "google_calendar", state: "live", observedAt: now, timeZone: "Asia/Ho_Chi_Minh",
    events: [{ title: "Sự kiện kiểm thử", start: now + 3600, end: now + 7200, allDay: false }],
  };
}

function updateCountdown(body, now) {
  countdownSample(now);
  if (body.action === "configure") {
    if (body.kind === "duration" && Number.isInteger(body.durationSeconds) && body.durationSeconds >= 1 && body.durationSeconds <= 359999) {
      countdown = { kind: "duration", state: "idle", durationSeconds: body.durationSeconds, targetEpochSeconds: null, remainingSeconds: body.durationSeconds };
      return true;
    }
    if (body.kind !== "target" || !Number.isInteger(body.targetEpochSeconds) || body.targetEpochSeconds < 1704067200 || body.targetEpochSeconds >= 4102444800) return false;
    countdown = { ...countdown, kind: "target", targetEpochSeconds: body.targetEpochSeconds, state: "running" };
    return true;
  }
  if (body.action === "reset") {
    countdown.state = "idle";
    countdown.remainingSeconds = countdown.kind === "duration" ? countdown.durationSeconds : null;
    return true;
  }
  if (body.action === "pause" && countdown.kind === "duration") {
    if (countdown.state === "running") countdown.state = "paused";
    return true;
  }
  if (body.action !== "start") return false;
  if (countdown.state !== "running") {
    if (countdown.kind === "duration") {
      const remaining = countdown.state === "paused" ? countdown.remainingSeconds : countdown.durationSeconds;
      countdownEnds = now + remaining * 1000;
    }
    countdown.state = "running";
  }
  return true;
}

function status(now) {
  const { state, lastSync, error } = githubData();
  return {
    deviceName: config.deviceName,
    mode,
    wifi: { connected: true, ip: "127.0.0.1", hostname: "smart-desk-fixture.local", provisioning: false },
    uptimeSeconds: Math.floor((now - startedAt) / 1000),
    firmwareVersion: "fixture-1",
    time: { synced: timeSynced, epochSeconds: timeSynced ? Math.floor(Date.now() / 1000) : null, timezone: "Asia/Ho_Chi_Minh", utcOffsetMinutes: 420 },
    github: { state, lastSync, error },
    pomodoro: timer,
    ...(versionTwo ? { countdown: countdownSample(now) } : {}),
  };
}

function configure(patch, now) {
  const validation = {
    deviceName: (v) => typeof v === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,30}[A-Za-z0-9])?$/.test(v),
    githubUsername: (v) => typeof v === "string" && v.length <= 39 && /^(?:[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)?$/.test(v),
    githubProxyUrl: (v) => {
      if (v === "") return true;
      if (typeof v !== "string" || v.length > 200 || /[?#]/.test(v) || v.endsWith("/")) return false;
      try {
        const url = new URL(v);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    },
    theme: (v) => ["dark", "light"].includes(v),
    startupMode: (v) => modes.includes(v),
    clockShowSeconds: (v) => typeof v === "boolean",
  };
  for (const [field, value] of Object.entries(patch)) {
    if (field !== "rotation" && (!Object.hasOwn(validation, field) || !validation[field](value))) return field;
  }
  const rotationPatch = patch.rotation;
  if ("rotation" in patch && (!rotationPatch || typeof rotationPatch !== "object" || Array.isArray(rotationPatch))) return "rotation";
  for (const key of Object.keys(rotationPatch || {})) {
    if (!Object.hasOwn(config.rotation, key)) return `rotation.${key}`;
  }
  const rotation = { ...config.rotation, ...rotationPatch };
  if (typeof rotation.enabled !== "boolean") return "rotation.enabled";
  if (!Number.isInteger(rotation.intervalSeconds) || rotation.intervalSeconds < 30 || rotation.intervalSeconds > 600) return "rotation.intervalSeconds";
  if (!Array.isArray(rotation.modes) || rotation.modes.length < (rotation.enabled ? 2 : 1) ||
      new Set(rotation.modes).size !== rotation.modes.length || rotation.modes.some((item) => !modes.includes(item))) return "rotation.modes";
  Object.assign(config, patch, { rotation });
  if (rotationPatch) rotationAt = now;
}

function updateMessage(patch) {
  const valid = {
    text: (v) => typeof v === "string" && v.length <= 160 && !/[^\x20-\x7e\n]/.test(v),
    alignment: (v) => ["left", "center", "right"].includes(v),
    color: (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v),
    size: (v) => Number.isInteger(v) && v >= 1 && v <= 4,
  };
  for (const [field, value] of Object.entries(patch)) {
    if (!Object.hasOwn(valid, field) || !valid[field](value)) return field;
  }
  Object.assign(config.message, patch);
}

function resetTimer(phase = "focus") {
  timer.phase = phase;
  timer.state = "idle";
  timer.remainingSeconds = (phase === "focus" ? timer.focusMinutes : timer.breakMinutes) * 60;
  timerEndsAt = null;
}

function updateTimer(action, now) {
  if (action === "reset") resetTimer();
  if (action === "start" && timer.state !== "running") {
    if (timer.state === "completed") resetTimer(timer.phase === "focus" ? "break" : "focus");
    timer.state = "running";
    timerEndsAt = now + timer.remainingSeconds * 1000;
  }
  if (action === "pause" && timer.state === "running") {
    timer.state = "paused";
    timerEndsAt = null;
  }
}

async function receive(req, res) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
    failure(res, 415, "unsupported_media_type", "Gửi JSON với Content-Type application/json.");
    return;
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length <= 2048) chunks.push(chunk);
  }
  if (length > 2048) {
    failure(res, 413, "body_too_large", "Yêu cầu quá lớn.");
    return;
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError();
    return data;
  } catch {
    failure(res, 400, "invalid_json", "Dữ liệu JSON không hợp lệ.");
  }
}

async function route(req, res) {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  res.setHeader("X-SmartDesk-Fixture", "1");
  const file = files.get(path);
  if (file && ["GET", "HEAD"].includes(req.method)) {
    const [name, type] = file;
    let content = await readFile(new URL(`./public/${name}`, import.meta.url), name === "zah-avatar.webp" ? undefined : "utf8");
    if (name === "index.html") content = content.replace('id="fixture-banner" hidden', 'id="fixture-banner" data-fixture="true"');
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : content);
    return;
  }

  const now = performance.now();
  if (scenario === "offline" || (restartAt !== null && now < restartAt)) {
    failure(res, 503, "busy", "Fixture tạm thời mất kết nối.");
    return;
  }
  if (restartAt !== null) {
    startedAt = rotationAt = now;
    restartAt = null;
    mode = config.startupMode;
    resetTimer();
  }
  sync(now);

  if (req.method === "GET") {
    if (versionTwo && path === "/api/countdown") return reply(res, 200, countdownSample(now));
    if (versionTwo && path === "/api/calendar") return reply(res, 200, calendar());
    if (path === "/api/status") return reply(res, 200, status(now));
    if (path === "/api/config") return reply(res, 200, config);
    if (path === "/api/github") return reply(res, 200, githubData());
  }
  if (req.method !== "POST" || !path.startsWith("/api/")) return failure(res, 404, "not_found", "Không tìm thấy đường dẫn.");

  const data = await receive(req, res);
  if (!data) return;
  if (scenario === "reject") return failure(res, 503, "storage_unavailable", "Fixture từ chối thay đổi để kiểm thử lỗi.");

  let invalid;
  switch (path) {
    case "/api/countdown":
      if (!versionTwo) return failure(res, 404, "not_found", "Chưa hỗ trợ đếm ngược.");
      if (data.action === "pause" && countdown.kind === "target") return failure(res, 409, "action_not_supported", "Không thể tạm dừng mốc.");
      if (updateCountdown(data, now)) return ok(res, { countdown: countdownSample(now) });
      invalid = "action";
      break;
    case "/api/config":
      invalid = configure(data, now);
      if (!invalid) return ok(res, { config });
      break;
    case "/api/message":
      invalid = updateMessage(data);
      if (!invalid) return ok(res, { message: config.message });
      break;
    case "/api/display":
      if (Object.keys(data).length === 1 && modes.includes(data.mode)) {
        config.startupMode = mode = data.mode;
        rotationAt = now;
        return ok(res, { mode });
      }
      invalid = "mode";
      break;
    case "/api/pomodoro":
      if (Object.keys(data).length === 1 && ["start", "pause", "reset"].includes(data.action)) {
        updateTimer(data.action, now);
        return ok(res, { pomodoro: timer });
      }
      invalid = "action";
      break;
    case "/api/time/sync":
      if (Object.keys(data).length === 0) {
        timeSynced = true;
        return ok(res);
      }
      invalid = Object.keys(data)[0];
      break;
    case "/api/restart":
      if (Object.keys(data).length === 1 && data.confirm === true) {
        restartAt = now + 1700;
        return ok(res);
      }
      invalid = "confirm";
      break;
    default:
      return failure(res, 404, "not_found", "Không tìm thấy đường dẫn.");
  }
  failure(res, 400, "invalid_field", `Giá trị không hợp lệ (${invalid}).`, invalid);
}

createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) failure(res, 500, "fixture_error", "Fixture gặp lỗi nội bộ.");
    else res.end();
  });
}).listen(port, "127.0.0.1", function ready() {
  console.log(`Smart Desk fixture (${scenario}): http://127.0.0.1:${this.address().port}/`);
});
