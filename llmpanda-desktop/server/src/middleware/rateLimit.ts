import type { Request, Response, NextFunction } from 'express';

// Per-IP fixed-window rate limiter, shared by:
//   • the public /v1 proxy (PROXY_RATE_LIMIT_RPM, default 120/min) — caps flood/
//     brute-force of the unified key before any routing work.
//   • the /api/auth surface (AUTH_RATE_LIMIT_RPM, default 30/min) — blunts signup
//     floods + credential stuffing (login also has a per-email lockout in
//     routes/auth.ts as a second layer).
// Set the corresponding env to 0 to disable. req.ip is trustworthy only with
// `app.set('trust proxy', …)` configured for the deployment (see app.ts).

const WINDOW_MS = 60_000;
// Bound the IP map so a flood of distinct (e.g. spoofed) source addresses can't
// grow it without limit; expired entries are pruned opportunistically.
const MAX_TRACKED_IPS = 10_000;

interface WindowState {
  count: number;
  resetAt: number;
}

function parseRpm(envVar: string, def: number): number {
  const raw = process.env[envVar];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.floor(n);
}

export function createIpRateLimiter(opts: { limit: number; windowMs?: number }) {
  const { limit } = opts;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const windows = new Map<string, WindowState>();

  return function ipRateLimit(req: Request, res: Response, next: NextFunction): void {
    if (limit === 0) {
      next();
      return;
    }

    const now = Date.now();
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    let state = windows.get(ip);
    if (!state || now >= state.resetAt) {
      state = { count: 0, resetAt: now + windowMs };
      windows.set(ip, state);
    }
    state.count += 1;

    if (windows.size > MAX_TRACKED_IPS) {
      for (const [key, value] of windows) {
        if (now >= value.resetAt) windows.delete(key);
      }
    }

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - state.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(state.resetAt / 1000)));

    if (state.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: {
          message: `Rate limit exceeded: more than ${limit} requests per minute. Retry in ${retryAfter}s.`,
          type: 'rate_limit_error',
        },
      });
      return;
    }

    next();
  };
}

/** Per-IP limiter for the /v1 proxy (PROXY_RATE_LIMIT_RPM, default 120/min). */
export function createProxyRateLimiter() {
  return createIpRateLimiter({ limit: parseRpm('PROXY_RATE_LIMIT_RPM', 120) });
}

/** Per-IP limiter for /api/auth (AUTH_RATE_LIMIT_RPM, default 30/min). */
export function createAuthRateLimiter() {
  return createIpRateLimiter({ limit: parseRpm('AUTH_RATE_LIMIT_RPM', 30) });
}
