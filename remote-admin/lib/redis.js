export function redisClient({ url, token, fetchImpl = fetch }) {
  return async function exec(...args) {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('redis_unavailable');
    const data = await response.json();
    if (data.error || !Object.hasOwn(data, 'result')) throw new Error('redis_unavailable');
    return data.result;
  };
}

const prefix = 'smart-desk:remote:v1:';
const key = (name) => prefix + name;

const LIMIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

const ENQUEUE = `
local prior = redis.call('GET', KEYS[1])
if prior then
  if cjson.decode(prior).fingerprint ~= ARGV[3] then return {'id_conflict'} end
  return {'ok', prior}
end
local seen = redis.call('GET', KEYS[2])
if not seen or tonumber(ARGV[1]) - tonumber(seen) > 75 then return {'device_offline'} end
if redis.call('EXISTS', KEYS[3]) == 1 then return {'command_pending'} end
redis.call('SET', KEYS[1], ARGV[2], 'EX', 86400)
redis.call('SET', KEYS[3], ARGV[4], 'EX', 90)
redis.call('SET', KEYS[4], ARGV[4], 'EX', 86400)
return {'ok', ARGV[2]}
`;

const SYNC = `
if not redis.call('SET', KEYS[1], '1', 'EX', 181, 'NX') then return {'replay'} end
redis.call('SET', KEYS[2], ARGV[1], 'EX', 86400)
redis.call('SET', KEYS[3], ARGV[2], 'EX', 86400)
local ackId = ''
local pending = redis.call('GET', KEYS[4])
if ARGV[3] ~= '' then
  local record = redis.call('GET', KEYS[5])
  if record then
    local command = cjson.decode(record)
    if command.delivered then
      ackId = command.id
      if command.state == 'queued' and tonumber(ARGV[1]) < command.expiresAt then
        local ack = cjson.decode(ARGV[3])
        command.ack = ack
        command.state = ack.result
        command.acknowledgedAtMs = tonumber(ARGV[5])
        redis.call('SET', KEYS[5], cjson.encode(command), 'KEEPTTL')
      end
      if pending == ackId then
        redis.call('DEL', KEYS[4])
        pending = false
      end
    end
  end
end
local poll = redis.call('EXISTS', KEYS[6]) == 1 and 3000 or 60000
if not pending then return {'ok', ackId, '', poll} end
local recordKey = ARGV[4] .. pending
local record = redis.call('GET', recordKey)
if not record then return {'ok', ackId, '', poll} end
local command = cjson.decode(record)
if tonumber(ARGV[1]) >= command.expiresAt then return {'ok', ackId, '', poll} end
if not command.delivered then
  command.delivered = true
  command.deliveredAtMs = tonumber(ARGV[5])
  record = cjson.encode(command)
  redis.call('SET', recordKey, record, 'KEEPTTL')
end
return {'ok', ackId, record, poll}
`;

const STATE = `
local lastSeen = redis.call('GET', KEYS[1])
local snapshot = redis.call('GET', KEYS[2])
local latest = redis.call('GET', KEYS[3])
local command = latest and redis.call('GET', ARGV[4] .. latest)
if ARGV[3] == '1' and lastSeen and tonumber(ARGV[1]) - tonumber(lastSeen) <= 75 then
  local remaining = math.max(0, redis.call('TTL', KEYS[4]))
  if remaining <= 60 then
    local used = tonumber(redis.call('GET', KEYS[5])) or 0
    local extension = math.min(120 - remaining, 1800 - used, tonumber(ARGV[2]) - remaining)
    if extension > 0 then
      redis.call('SET', KEYS[5], used + extension, 'EX', ARGV[2])
      redis.call('SET', KEYS[4], '1', 'EX', remaining + extension)
    end
  end
end
return {lastSeen or '', snapshot or '', command or ''}
`;

const TAKE_OAUTH_STATE = `
local raw = redis.call('GET', KEYS[1])
if not raw or cjson.decode(raw).nonce ~= ARGV[1] then return '' end
redis.call('DEL', KEYS[1])
return raw
`;

const REMOVE_OAUTH_GRANT = `
local raw = redis.call('GET', KEYS[1])
redis.call('DEL', KEYS[1], KEYS[2])
return raw
`;

export function store(exec) {
  const evalScript = (script, keys, args) => exec('EVAL', script, keys.length, ...keys, ...args);
  const commandKey = (id) => key('command:') + id;
  return {
    async limit(name, seconds) {
      return evalScript(LIMIT, [key('limit:') + name], [seconds]);
    },
    async putSession(id, session) {
      await exec('SET', key('session:') + id, JSON.stringify(session), 'EX', 28800);
    },
    async session(id) {
      const raw = await exec('GET', key('session:') + id);
      return raw === null ? null : JSON.parse(raw);
    },
    async deleteSession(id) {
      await exec('DEL', key('session:') + id);
    },
    async calendarGrant() {
      return JSON.parse(await exec('GET', key('calendar:oauth-grant')));
    },
    async putCalendarGrant(grant) {
      await exec('SET', key('calendar:oauth-grant'), JSON.stringify(grant));
    },
    async removeCalendarGrant() {
      return JSON.parse(await evalScript(REMOVE_OAUTH_GRANT,
        [key('calendar:oauth-grant'), key('calendar')], []));
    },
    async putCalendarState(id, value) {
      await exec('SET', key('calendar:oauth-state:') + id, JSON.stringify(value), 'EX', 600);
    },
    async takeCalendarState(id, nonce) {
      const raw = await evalScript(TAKE_OAUTH_STATE, [key('calendar:oauth-state:') + id], [nonce]);
      return raw ? JSON.parse(raw) : null;
    },
    async calendarSample() {
      return JSON.parse(await exec('GET', key('calendar')));
    },
    async claimCalendarRefresh() {
      return await exec('SET', key('calendar:refresh'), '1', 'NX', 'EX', 60) === 'OK';
    },
    async putCalendar(sample) {
      await exec('SET', key('calendar'), JSON.stringify(sample), 'EX', 3600);
    },
    async state(now, interactive = false) {
      const day = Math.floor(now / 86400);
      const [lastSeen, snapshot, command] = await evalScript(STATE,
        [key('last-seen'), key('snapshot'), key('latest'), key('interactive'), key('interactive:' + day)],
        [now, (day + 1) * 86400 - now, interactive ? '1' : '0', key('command:')]);
      return { lastSeen: lastSeen ? Number(lastSeen) : null, snapshot: snapshot ? JSON.parse(snapshot) : null,
        command: command ? JSON.parse(command) : null };
    },
    async command(id) {
      const raw = await exec('GET', commandKey(id));
      return raw === null ? null : JSON.parse(raw);
    },
    async enqueue(command, now) {
      const [state, raw] = await evalScript(ENQUEUE, [
        commandKey(command.id), key('last-seen'), key('pending'), key('latest'),
      ], [now, JSON.stringify(command), command.fingerprint, command.id]);
      return { state, command: raw ? JSON.parse(raw) : null };
    },
    async sync({ nonce, now, nowMs = now * 1000, snapshot, ack }) {
      const [state, ackId, command, pollAfterMs] = await evalScript(SYNC, [
        key('nonce:') + nonce, key('last-seen'), key('snapshot'),
        key('pending'), commandKey(ack?.id ?? '-'), key('interactive'),
      ], [now, JSON.stringify(snapshot), ack ? JSON.stringify(ack) : '', key('command:'), nowMs]);
      return { state, ackId: ackId || null, command: command ? JSON.parse(command) : null, pollAfterMs };
    },
  };
}
