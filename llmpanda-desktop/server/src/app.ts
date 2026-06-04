import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { keysRouter } from './routes/keys.js';
import { modelsRouter } from './routes/models.js';
import { proxyRouter } from './routes/proxy.js';
import { embeddingsRouter } from './routes/embeddings.js';
import { responsesRouter } from './routes/responses.js';
import { fallbackRouter } from './routes/fallback.js';
import { analyticsRouter } from './routes/analytics.js';
import { healthRouter } from './routes/health.js';
import { settingsRouter } from './routes/settings.js';
import { authRouter } from './routes/auth.js';
import { accountRouter } from './routes/account.js';
import { billingRouter, stripeWebhookRouter } from './routes/billing.js';
import { requireAuth } from './middleware/requireAuth.js';
import { createProxyRateLimiter, createAuthRateLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId, requestLogger } from './middleware/observability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DASHBOARD_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
];

const IS_PROD = process.env.NODE_ENV === 'production';

function getAllowedCorsOrigins() {
  const configuredOrigins = (process.env.DASHBOARD_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  // In production, lock CORS to the configured dashboard origin(s) only — do NOT
  // ship the localhost defaults. Warn loudly if nothing is configured.
  if (IS_PROD) {
    if (configuredOrigins.length === 0) {
      console.warn('[cors] DASHBOARD_ORIGINS is not set in production — the dashboard origin will be rejected. Set it to your public URL.');
    }
    return new Set(configuredOrigins);
  }
  return new Set([...DEFAULT_DASHBOARD_ORIGINS, ...configuredOrigins]);
}

export function createApp() {
  const app = express();
  // Behind a reverse proxy / CDN in production so req.ip (rate limiting) reflects
  // the real client, not the proxy. One hop is the common case (one LB/CDN).
  app.set('trust proxy', IS_PROD ? 1 : false);
  const allowedCorsOrigins = getAllowedCorsOrigins();

  // In production serve a strict, SPA-safe CSP + HSTS (HTTPS deploy). In dev both
  // are off: HSTS would pin localhost to HTTPS, and a CSP complicates Vite's HMR.
  // CSP allows same-origin assets, inline styles (Tailwind), data: fonts/images,
  // and Sentry's ingest endpoint for the browser SDK.
  app.use(helmet(IS_PROD
    ? {
        contentSecurityPolicy: {
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            imgSrc: ["'self'", 'data:'],
            fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
            connectSrc: ["'self'", 'https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: [],
          },
        },
        hsts: { maxAge: 15552000, includeSubDomains: true },
      }
    : { contentSecurityPolicy: false, hsts: false }));
  app.use(cors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      callback(null, !origin || allowedCorsOrigins.has(origin));
    },
  }));

  // Request correlation id on every request (before logging/routes).
  app.use(requestId);

  // Stripe webhook needs the RAW body for signature verification — mount it
  // BEFORE express.json so the JSON parser doesn't consume the stream. (#P5)
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookRouter);

  // The /v1 proxy carries base64 image uploads (vision input) + large embedding
  // batches, so it gets a bigger body limit than the dashboard API. Mounted
  // before the global 1mb parser so it wins for /v1; the global parser then
  // no-ops on /v1 (body already read).
  app.use('/v1', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  // Dashboard auth (#35): /api/auth/{status,setup,login} bootstrap without a
  // session; everything else under /api/* requires a logged-in dashboard user.
  // The /v1 proxy keeps its own unified-API-key auth and is NOT gated here.
  app.use('/api/auth', createAuthRateLimiter(), authRouter);

  // API routes — all admin endpoints sit behind requireAuth.
  app.use('/api/keys', requireAuth, keysRouter);
  app.use('/api/models', requireAuth, modelsRouter);
  app.use('/api/fallback', requireAuth, fallbackRouter);
  app.use('/api/analytics', requireAuth, analyticsRouter);
  app.use('/api/health', requireAuth, healthRouter);
  app.use('/api/settings', requireAuth, settingsRouter);
  app.use('/api/account', requireAuth, accountRouter);
  app.use('/api/billing', requireAuth, billingRouter);

  // OpenAI-compatible proxy. Per-IP rate limiting (#35 item #6) runs first so
  // it throttles unauthenticated brute-force / flood attempts before any
  // routing work. Tune via PROXY_RATE_LIMIT_RPM; 0 disables it.
  app.use('/v1', createProxyRateLimiter());
  app.use('/v1', proxyRouter);
  app.use('/v1/embeddings', embeddingsRouter);
  // OpenAI Responses API shim (Codex CLI requires wire_api="responses"; see #96)
  app.use('/v1', responsesRouter);

  // Health check
  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Sentry must capture errors AFTER all controllers, BEFORE our own handler.
  Sentry.setupExpressErrorHandler(app);

  // Error handler (for API routes)
  app.use(errorHandler);

  // Serve client static files (after API error handler). CLIENT_DIST lets the
  // desktop (Electron) build point at the packaged client regardless of layout.
  const clientDist = process.env.CLIENT_DIST
    ? path.resolve(process.env.CLIENT_DIST)
    : path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for non-API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}
