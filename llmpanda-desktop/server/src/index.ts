import './env.js';
import './instrument.js'; // Sentry — must load before the app
import { createApp } from './app.js';
import { initDb } from './db/index.js';
import { startHealthChecker } from './services/health.js';
import { startWorkers } from './services/worker.js';

const PORT = process.env.PORT ?? 3001;

async function main() {
  await initDb();
  const app = createApp();

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Proxy endpoint: http://0.0.0.0:${PORT}/v1/chat/completions`);
    // Health + housekeeping run in pg-boss (out of the request path, multi-instance
    // safe). If the queue can't start, fall back to the in-process interval so a
    // single instance still health-checks.
    startWorkers().catch(err => {
      console.error('[worker] pg-boss failed to start, using in-process health checker:', err?.message ?? err);
      startHealthChecker();
    });
  });
}

main().catch((err) => {
  // A boot failure (e.g. a missing production ENCRYPTION_KEY) must exit
  // non-zero rather than leaving a half-initialized process that never starts
  // listening — that silent state is what surfaces in the client as
  // "Can't reach the server".
  console.error('\n[server] Failed to start:\n  ' + (err?.message ?? err) + '\n');
  process.exit(1);
});
