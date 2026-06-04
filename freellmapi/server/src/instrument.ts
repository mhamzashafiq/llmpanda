import * as Sentry from '@sentry/node';

// Initialise Sentry as early as possible (imported before the app in index.ts)
// so auto-instrumentation can patch http/express. Error monitoring only —
// tracing/profiling are off to stay on the free tier and keep overhead low.
// DSN comes from SENTRY_DSN (set in .env); the literal is the fallback for dev.
const dsn = process.env.SENTRY_DSN
  ?? 'https://8eb75842c1ace780938bfdc28d386635@o4511498078191616.ingest.us.sentry.io/4511498081861632';

// Variable names that may hold a secret in a captured stack frame. The /v1 path
// decrypts upstream provider keys into locals (route.apiKey, decryptedKey,
// apiKey) and request headers carry the tenant's unified key — none of that may
// leave the box in an error event.
const SECRET_VAR = /^(api_?key|decryptedkey|key|encrypted_?key|iv|auth_?tag|unified_?key|token|password|password_?hash|secret)$/i;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // PII OFF: do NOT attach request bodies/headers by default. We additionally
    // scrub auth headers + secret-shaped frame locals in beforeSend so a crash
    // on the proxy path can never exfiltrate a unified or provider API key.
    sendDefaultPii: false,
    beforeSend(event) {
      const headers = event.request?.headers as Record<string, unknown> | undefined;
      if (headers) {
        for (const h of Object.keys(headers)) {
          if (/^(authorization|x-api-key|cookie)$/i.test(h)) headers[h] = '[redacted]';
        }
      }
      for (const ex of event.exception?.values ?? []) {
        for (const frame of ex.stacktrace?.frames ?? []) {
          const vars = frame.vars as Record<string, unknown> | undefined;
          if (vars) {
            for (const v of Object.keys(vars)) {
              if (SECRET_VAR.test(v)) vars[v] = '[redacted]';
            }
          }
        }
      }
      return event;
    },
    // Captures uncaughtException / unhandledRejection by default.
  });
  console.log('[sentry] error monitoring enabled');
}

export { Sentry };
