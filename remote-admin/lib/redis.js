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
        redis.call('SET', KEYS[5], cjson.encode(command), 'KEEPTTL')
      end
      if pending == ackId then
        redis.call('DEL', KEYS[4])
        pending = false
      end
    end
  end
end
if not pending then return {'ok', ackId, ''} end
local recordKey = ARGV[4] .. pending
local record = redis.call('GET', recordKey)
if not record then return {'ok', ackId, ''} end
local command = cjson.decode(record)
if tonumber(ARGV[1]) >= command.expiresAt then return {'ok', ackId, ''} end
if not command.delivered then
  command.delivered = true
  record = cjson.encode(command)
  redis.call('SET', recordKey, record, 'KEEPTTL')
end
return {'ok', ackId, record}
`;

const STORE_QUOTA = `
local raw = redis.call('GET', KEYS[1])
if not raw or cjson.decode(raw).observedAt <= tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', 86400)
end
return 1
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
    async integrationSamples() {
      const [calendar, codex, claude] = await exec('MGET', key('calendar'), key('quota:codex'), key('quota:claude'));
      return { calendar: JSON.parse(calendar), codex: JSON.parse(codex), claude: JSON.parse(claude) };
    },
    async claimCalendarRefresh() {
      return await exec('SET', key('calendar:refresh'), '1', 'NX', 'EX', 60) === 'OK';
    },
    async putCalendar(sample) {
      await exec('SET', key('calendar'), JSON.stringify(sample), 'EX', 3600);
    },
    async putQuota(provider, sample) {
      await evalScript(STORE_QUOTA, [key('quota:') + provider], [sample.observedAt, JSON.stringify(sample)]);
    },
    async state() {
      const [lastSeen, snapshot, latest] = await exec(
        'MGET', key('last-seen'), key('snapshot'), key('latest'),
      );
      const command = latest ? await this.command(latest) : null;
      return { lastSeen: lastSeen === null ? null : Number(lastSeen), snapshot: snapshot ? JSON.parse(snapshot) : null, command };
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
    async sync({ nonce, now, snapshot, ack }) {
      const [state, ackId, command] = await evalScript(SYNC, [
        key('nonce:') + nonce, key('last-seen'), key('snapshot'),
        key('pending'), commandKey(ack?.id ?? '-'),
      ], [now, JSON.stringify(snapshot), ack ? JSON.stringify(ack) : '', key('command:')]);
      return { state, ackId: ackId || null, command: command ? JSON.parse(command) : null };
    },
  };
}
