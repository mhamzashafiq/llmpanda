import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Phase 8: request correlation id + structured access log. Every request gets an
// id (honoring an inbound X-Request-Id for distributed tracing) echoed back on
// the response; one JSON log line per API/proxy request with id, status, latency
// and the resolved org for tenant-aware debugging.

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming)?.slice(0, 100) || crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Only log API + proxy traffic; static asset noise is not useful.
  if (!(req.path.startsWith('/api/') || req.path.startsWith('/v1'))) {
    next();
    return;
  }
  const start = Date.now();
  res.on('finish', () => {
    const line = {
      t: new Date().toISOString(),
      lvl: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      id: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      org: req.user?.orgId,
    };
    console.log(JSON.stringify(line));
  });
  next();
}
