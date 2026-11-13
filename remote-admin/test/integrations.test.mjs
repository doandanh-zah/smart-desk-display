import assert from 'node:assert/strict';
import test from 'node:test';
import { CALENDAR_SCOPE, googleCalendar, integrations, minimalEvents } from '../lib/integrations.js';
import { commandPayload } from '../lib/validate.js';

const time = Date.parse('2026-11-13T04:00:00Z') / 1000;
const future = time + 7200;
const start = new Date((time + 60) * 1000).toISOString();
const end = new Date((time + 120) * 1000).toISOString();

test('Google Calendar read-only requests primary events with a minimal field mask', async () => {
  const calls = [];
  const read = googleCalendar({
    GOOGLE_CALENDAR_CLIENT_ID: 'fixture-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret',
    GOOGLE_CALENDAR_REFRESH_TOKEN: 'fixture-refresh',
  }, async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(options.redirect, 'error');
    if (url.host === 'oauth2.googleapis.com') {
      assert.equal(options.body.get('grant_type'), 'refresh_token');
      return Response.json({ scope: CALENDAR_SCOPE, access_token: 'fixture-access', expires_in: 3600 });
    }
    assert.equal(url.pathname, '/calendar/v3/calendars/primary/events');
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.match(url.searchParams.get('fields'), /summary,start\(/);
    assert.doesNotMatch(url.searchParams.get('fields'), /description|attendees|location|htmlLink/);
    assert.equal(options.headers.authorization, 'Bearer fixture-access');
    return Response.json({ timeZone: 'Asia/Ho_Chi_Minh', items: [
      { summary: 'Secret', visibility: 'private', description: 'Ignore me', start: { dateTime: start }, end: { dateTime: end } },
    ] });
  });
  assert.deepEqual(await read(time), [{ title: 'Sự kiện', start: time + 60, end: time + 120, allDay: false }]);
  await read(time + 300);
  assert.equal(calls.filter((url) => url.host === 'oauth2.googleapis.com').length, 1);
});

test('calendar preserves all-day dates in source timezone and bounds title by UTF-8 bytes', () => {
  const events = minimalEvents([
    { summary: 'Họp'.repeat(90), start: { date: '2026-11-13' }, end: { date: '2026-11-14' } },
    { summary: 'Cancelled', status: 'cancelled', start: { dateTime: start }, end: { dateTime: end } },
  ], 'America/Los_Angeles', time);
  assert.equal(events.length, 1);
  assert.equal(events[0].start, Date.parse('2026-11-13T08:00:00Z') / 1000);
  assert.equal(events[0].allDay, true);
  assert.ok(Buffer.byteLength(events[0].title) <= 64);
});

test('calendar device export is opt-in and expired snapshots do not appear', async () => {
  const cached = { observedAt: time - 301, events: [
    { title: 'Old', start: time - 2, end: time - 1, allDay: false },
    { title: 'Next', start: time + 1, end: future, allDay: false },
  ] };
  const db = { calendarSample: async () => cached, claimCalendarRefresh: async () => false };
  const noExport = integrations(db, { env: {}, fetchCalendar: async () => [] });
  assert.equal((await noExport(time, true)).calendar.state, 'unavailable');
  const browser = (await noExport(time)).calendar;
  assert.equal(browser.state, 'stale');
  assert.deepEqual(browser.events.map((x) => x.title), ['Next']);
  assert.equal((await noExport(time + 3600)).calendar.state, 'unavailable');
});

test('new countdown commands use the same bounded cloud allowlist as LAN', () => {
  const input = { action: 'configure', kind: 'target', targetEpochSeconds: future };
  assert.deepEqual(commandPayload('countdown', input), input);
  assert.equal(commandPayload('countdown', { ...input, durationSeconds: 60 }), null);
  assert.equal(commandPayload('countdown', { action: 'configure', kind: 'duration', durationSeconds: 360000 }), null);
  for (const mode of ['codex', 'claude']) {
    assert.equal(commandPayload('display', { mode }), null);
    assert.equal(commandPayload('config', { rotation: { enabled: true, intervalSeconds: 60, modes: ['github', mode] } }), null);
  }
});
