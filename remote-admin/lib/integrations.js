const TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';
const quotaSources = { codex: 'codex_app_server', claude: 'claude_code_statusline' };
const quotaWindows = { codex: ['primary', 'secondary'], claude: ['five_hour', 'seven_day'] };
const quotas = ['codex', 'claude'];
const validSeconds = (value) => Number.isInteger(value) && value > 0 && value < 4102444800;

export function normalizeQuota(provider, sample) {
  if (!quotas.includes(provider) || !sample ||
      !validSeconds(sample.observedAt) || !Array.isArray(sample.windows) || sample.windows.length > 2 ||
      !['live', 'unsupported', 'unavailable'].includes(sample.state)) return null;
  const ids = new Set();
  const windows = [];
  for (const entry of sample.windows) {
    if (!entry || !quotaWindows[provider].includes(entry.id) || ids.has(entry.id) ||
        !Number.isFinite(entry.usedPercent) || entry.usedPercent < 0 || entry.usedPercent > 100 ||
        (entry.resetsAt !== null && !validSeconds(entry.resetsAt)) ||
        (entry.windowMinutes !== null && (!Number.isInteger(entry.windowMinutes) ||
          entry.windowMinutes <= 0 || entry.windowMinutes > 525600))) return null;
    ids.add(entry.id);
    windows.push({ id: entry.id, windowMinutes: entry.windowMinutes, resetsAt: entry.resetsAt,
      usedPercent: entry.usedPercent, used: null, limit: null, unit: null });
  }
  if ((sample.state === 'live') !== Boolean(windows.length)) return null;
  return { source: quotaSources[provider], kind: 'subscription', state: sample.state,
    observedAt: sample.observedAt, windows };
}

export function quotaView(provider, sample, now) {
  const quota = normalizeQuota(provider, sample);
  if (!quota || now - quota.observedAt >= 86400) {
    return { source: quotaSources[provider], kind: 'subscription', state: 'unavailable', observedAt: null, windows: [] };
  }
  if (quota.state === 'live' && (now - quota.observedAt > 900 ||
      quota.windows.some((window) => window.resetsAt !== null && window.resetsAt <= now))) {
    quota.state = 'stale';
  }
  return quota;
}

function dateTime(value, zone) {
  if (typeof value?.dateTime === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime)) {
    return Date.parse(value.dateTime) / 1000;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value?.date ?? '')) return NaN;
  const midnight = Date.parse(value.date + 'T00:00:00Z');
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== value.date) return NaN;
  const formatter = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' });
  let candidate = midnight;
  // Recalculate at the adjusted instant to handle DST offset changes.
  for (let i = 0; i < 3; i++) {
    const offset = formatter.formatToParts(candidate).find(({ type }) => type === 'timeZoneName')?.value;
    if (offset === 'GMT') return midnight / 1000;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset ?? '');
    if (!match) return NaN;
    const next = midnight - (match[1] === '+' ? 1 : -1) * (+match[2] * 60 + +match[3]) * 60_000;
    if (next === candidate) return next / 1000;
    candidate = next;
  }
  return NaN;
}

function clipTitle(value, maxBytes) {
  let result = '';
  let bytes = 0;
  for (const char of value) {
    bytes += Buffer.byteLength(char);
    if (bytes > maxBytes) break;
    result += char;
  }
  return result;
}

export function minimalEvents(items, zone, now) {
  if (!Array.isArray(items) || typeof zone !== 'string') throw new Error('invalid_calendar');
  // Validate the Google-supplied zone once even when the calendar is empty.
  new Intl.DateTimeFormat('en', { timeZone: zone });
  return items.flatMap((item) => {
    if (!item || item.status === 'cancelled') return [];
    const start = dateTime(item.start, item.start?.timeZone || zone);
    const end = dateTime(item.end, item.end?.timeZone || zone);
    if (!validSeconds(start) || !validSeconds(end) || end <= start || end <= now || start >= now + 172800) return [];
    const summary = ['private', 'confidential'].includes(item.visibility) ? '' : item.summary;
    const clean = typeof summary === 'string' ? summary.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim() : '';
    return [{ title: clipTitle(clean, 64) || 'Sự kiện', start, end, allDay: Boolean(item.start?.date) }];
  }).sort((a, b) => a.start - b.start || a.end - b.end).slice(0, 3);
}

export function googleCalendar(env, fetchImpl = fetch) {
  const { GOOGLE_CALENDAR_CLIENT_ID: id, GOOGLE_CALENDAR_CLIENT_SECRET: secret,
    GOOGLE_CALENDAR_REFRESH_TOKEN: refreshToken } = env;
  if (!id || !secret || !refreshToken) return null;
  let access;
  let expiresAt = 0;
  return async function read(now) {
    const signal = AbortSignal.timeout(2600);
    if (now >= expiresAt) {
      const response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST', redirect: 'error', signal,
        body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
      });
      if (!response.ok) throw new Error('calendar_auth_failed');
      const token = await response.json();
      if (typeof token.access_token !== 'string' || !Number.isFinite(token.expires_in) ||
          (token.scope && token.scope.trim() !== CALENDAR_SCOPE)) throw new Error('calendar_auth_failed');
      access = token.access_token;
      expiresAt = now + Math.max(0, token.expires_in - 60);
    }
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.search = new URLSearchParams({
      timeMin: new Date(now * 1000).toISOString(), timeMax: new Date((now + 172800) * 1000).toISOString(),
      singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '100',
      fields: 'timeZone,items(summary,start(date,dateTime,timeZone),end(date,dateTime,timeZone),status,visibility)',
    });
    const response = await fetchImpl(url, { headers: { authorization: 'Bearer ' + access }, redirect: 'error', signal });
    if (!response.ok) {
      if (response.status === 401) expiresAt = 0;
      throw new Error('calendar_unavailable');
    }
    const data = await response.json();
    return minimalEvents(data.items ?? [], data.timeZone, now);
  };
}

export function integrations(db, { env, fetchCalendar = googleCalendar(env), waitUntil } = {}) {
  const calendarUnavailable = { source: 'google_calendar', state: 'unavailable', observedAt: null, timeZone: TIME_ZONE, events: [] };
  return async function view(now, device = false) {
    const exposeCalendar = Boolean(fetchCalendar) && (!device || env.GOOGLE_CALENDAR_DEVICE_EXPORT === '1');
    let samples;
    try {
      samples = await db.integrationSamples();
    } catch {
      samples = {};
    }
    let calendar = calendarUnavailable;
    const cached = samples.calendar;
    if (exposeCalendar && validSeconds(cached?.observedAt) && now - cached.observedAt < 3600 && Array.isArray(cached.events)) {
      calendar = { ...calendarUnavailable, observedAt: cached.observedAt,
        state: now - cached.observedAt < 300 ? 'live' : 'stale',
        events: cached.events.filter((item) => item.end > now) };
    }
    if (exposeCalendar && calendar.state !== 'live') {
      const refresh = async () => {
        if (!await db.claimCalendarRefresh()) return null;
        const events = await fetchCalendar(now);
        await db.putCalendar({ observedAt: now, events });
        return { ...calendarUnavailable, state: 'live', observedAt: now, events };
      };
      if (device) {
        if (waitUntil) waitUntil(refresh().catch(() => {}));
      } else {
        calendar = await refresh().catch(() => null) ?? calendar;
      }
    }
    return { v: 1, calendar, quotas: {
      codex: quotaView('codex', samples.codex, now), claude: quotaView('claude', samples.claude, now),
    } };
  };
}
