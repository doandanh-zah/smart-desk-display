const DAY_MS = 86_400_000;
const DAYS = 52 * 7;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const LEVELS = new Map([
  ['NONE', 0],
  ['FIRST_QUARTILE', 1],
  ['SECOND_QUARTILE', 2],
  ['THIRD_QUARTILE', 3],
  ['FOURTH_QUARTILE', 4],
]);

export function validUsername(value) {
  return typeof value === 'string' && value.length <= 39 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value) && !/\s/.test(value);
}

export function windowFor(now) {
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const weekday = new Date(today).getUTCDay();
  return {
    start: today - (51 * 7 + weekday) * DAY_MS,
    today,
    through: now.toISOString(),
  };
}

export function isoDate(milliseconds) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export function compactCalendar(user, username, { start, today }) {
  const calendar = user?.contributionsCollection?.contributionCalendar;
  if (!validUsername(user?.login) || user.login.toLowerCase() !== username ||
      !Array.isArray(calendar?.weeks) || !calendar.weeks.length) {
    throw new Error('Invalid calendar');
  }

  const levels = Array(DAYS).fill(0);
  const counts = new Map();
  let total = 0;
  for (const week of calendar.weeks) {
    if (!Array.isArray(week?.contributionDays)) throw new Error('Invalid week');
    for (const day of week.contributionDays) {
      const date = typeof day?.date === 'string' && DATE.test(day.date)
        ? Date.parse(day.date)
        : NaN;
      if (!Number.isFinite(date) || isoDate(date) !== day.date) {
        throw new Error('Invalid calendar date');
      }
      if (date < start || date > today) continue;
      const level = LEVELS.get(day.contributionLevel);
      const count = day.contributionCount;
      if (counts.has(date) || level === undefined || !isMetric(count) ||
          (count === 0) !== (level === 0)) {
        throw new Error('Invalid calendar day');
      }
      counts.set(date, count);
      levels[(date - start) / DAY_MS] = level;
      total += count;
    }
  }
  if (!counts.size || total > 0xffffffff) throw new Error('Invalid calendar total');

  let streak = 0;
  let date = counts.get(today) ? today : today - DAY_MS;
  while (counts.get(date)) {
    streak++;
    date -= DAY_MS;
  }

  const repos = user.repositories?.totalCount;
  return {
    v: 1,
    username: user.login,
    start: isoDate(start),
    asOf: isoDate(today),
    levels: levels.join(''),
    total,
    streak,
    repos: isMetric(repos) ? repos : null,
  };
}

function isMetric(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0x7fffffff;
}
