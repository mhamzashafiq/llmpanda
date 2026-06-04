import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App'

// Error monitoring — activates only when VITE_SENTRY_DSN is set (create a
// "React" project in Sentry and put its DSN in client/.env).
const dsn = import.meta.env.VITE_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // PII off — dashboard requests carry the unified API key + session token in
    // headers; don't ship those to Sentry.
    sendDefaultPii: false,
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div className="apex flex min-h-screen items-center justify-center bg-[#191919] p-6 text-center text-white">
          <p className="font-display text-sm uppercase tracking-widest text-[#ff4d4f]">
            Something went wrong. Reload the page.
          </p>
        </div>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
