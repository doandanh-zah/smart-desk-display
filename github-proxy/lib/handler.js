import { compactCalendar, isoDate, validUsername, windowFor } from './calendar.js';

const GITHUB_API = 'https://api.github.com/graphql';
const CACHE_SECONDS = 300;
const CACHE_ENTRIES = 128;
const MAX_IN_FLIGHT = 8;
const UPSTREAM_TIMEOUT_MS = 6_000;

const QUERY = `
  query Contributions($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      login
      repositories(first: 1, privacy: PUBLIC, ownerAffiliations: [OWNER]) {
        totalCount
      }
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date contributionCount contributionLevel color }
          }
        }
      }
    }
  }
`;

class ProxyError extends Error {
  constructor(status, code, retryAfter = 0) {
    super(code);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function retrySeconds(headers, nowMs) {
  const retry = headers.get('retry-after');
  let seconds = 0;
  if (retry && /^\d+$/.test(retry)) {
    seconds = Number(retry);
  } else if (retry) {
    seconds = Math.ceil((Date.parse(retry) - nowMs) / 1000);
  }
  if (!(seconds > 0) && headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'));
    seconds = Math.ceil(reset - nowMs / 1000);
  }
  return seconds > 0 ? Math.min(seconds, 86_400) : 60;
}

function isRateLimited(response, errors) {
  return response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
       response.headers.has('retry-after'))) ||
    errors.some((error) =>
      [error?.type, error?.extensions?.code].includes('RATE_LIMITED') ||
      /(?:secondary )?rate limit/i.test(error?.message ?? ''));
}

async function fetchCalendar(fetchImpl, token, username, window, now) {
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(GITHUB_API, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'smart-desk-display',
      },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          login: username,
          from: new Date(window.start).toISOString(),
          to: window.through,
        },
      }),
      signal,
    });

    if (isRateLimited(response, [])) {
      await response.body?.cancel();
      throw new ProxyError(429, 'rate_limited', retrySeconds(response.headers, now().getTime()));
    }
    const body = await response.json();
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    if (isRateLimited(response, errors) ||
        (response.status === 403 && /rate limit/i.test(body?.message ?? ''))) {
      throw new ProxyError(429, 'rate_limited', retrySeconds(response.headers, now().getTime()));
    }
    if (!response.ok) throw new ProxyError(502, 'upstream_error');
    const user = body?.data?.user;
    if (user === null && (!errors.length || errors.every((error) =>
      error?.type === 'NOT_FOUND' && Array.isArray(error.path) &&
      error.path.length === 1 && error.path[0] === 'user'))) {
      throw new ProxyError(404, 'user_not_found');
    }

    // Keep the calendar when only the optional repository count failed.
    if (errors.some((error) =>
      error?.path?.[0] !== 'user' || error?.path?.[1] !== 'repositories')) {
      throw new ProxyError(502, 'upstream_error');
    }
    return compactCalendar(user, username, window);
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    if (signal.aborted || error?.name === 'TimeoutError') {
      throw new ProxyError(504, 'upstream_timeout');
    }
    throw new ProxyError(502, 'upstream_error');
  }
}

function errorResponse(status, code, headers = {}) {
  return Response.json({ error: code }, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

export function createHandler({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  getToken = () => process.env.GITHUB_TOKEN?.trim(),
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let rateLimitedUntil = 0;

  return async function handle(request) {
    if (request.method !== 'GET') {
      return errorResponse(405, 'method_not_allowed', { Allow: 'GET' });
    }
    const values = new URL(request.url).searchParams.getAll('username');
    if (values.length !== 1 || !validUsername(values[0])) {
      return errorResponse(400, 'invalid_username');
    }
    const token = getToken();
    if (!token) return errorResponse(503, 'proxy_unconfigured');

    const username = values[0].toLowerCase();
    const requestedAt = now();
    const window = windowFor(requestedAt);
    const key = `${username}:${isoDate(window.today)}`;
    const time = requestedAt.getTime();
    const cached = cache.get(key);
    if (cached && cached.expires <= time) cache.delete(key);
    let entry = cache.get(key);

    try {
      if (!entry) {
        let pending = inFlight.get(key);
        if (!pending) {
          if (time < rateLimitedUntil) {
            throw new ProxyError(429, 'rate_limited', Math.ceil((rateLimitedUntil - time) / 1000));
          }
          if (inFlight.size >= MAX_IN_FLIGHT) throw new ProxyError(429, 'rate_limited', 10);

          pending = fetchCalendar(fetchImpl, token, username, window, now)
            .then((data) => {
              const expires = Math.min(time + CACHE_SECONDS * 1000, window.today + 86_400_000);
              const result = { data, expires };
              if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value);
              cache.set(key, result);
              return result;
            })
            .catch((error) => {
              if (error.status === 429) {
                rateLimitedUntil = Math.max(rateLimitedUntil, now().getTime() + error.retryAfter * 1000);
              }
              throw error;
            })
            .finally(() => inFlight.delete(key));
          inFlight.set(key, pending);
        }
        entry = await pending;
      }

      const remaining = Math.floor((entry.expires - now().getTime()) / 1000);
      return Response.json(entry.data, {
        headers: remaining > 0
          ? { 'Cache-Control': 'public, max-age=0', 'Vercel-CDN-Cache-Control': `public, max-age=${remaining}` }
          : { 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      if (!(error instanceof ProxyError)) return errorResponse(502, 'upstream_error');
      const headers = error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
      return errorResponse(error.status, error.message, headers);
    }
  };
}
