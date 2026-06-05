import { useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthScreen, RequireAuth, VerifyScreen, ResetPasswordScreen, OAuthCallback, OnboardingScreen } from '@/components/auth-gate'
import LandingPage from '@/pages/LandingPage'
import { PrivacyPage, TermsPage } from '@/pages/LegalPages'
import { logout } from '@/lib/api'
import { cn } from '@/lib/utils'
import KeysPage from '@/pages/KeysPage'
import PlaygroundPage from '@/pages/PlaygroundPage'
import FallbackPage from '@/pages/FallbackPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import RequestsPage from '@/pages/RequestsPage'
import ApiKeyPage from '@/pages/ApiKeyPage'
import DocsPage from '@/pages/DocsPage'
import AgentsPage from '@/pages/AgentsPage'

const queryClient = new QueryClient()

/* ── nav icons ───────────────────────────────────── */
const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'w-[18px] h-[18px] shrink-0',
}
const ICONS: Record<string, ReactNode> = {
  playground: <svg {...iconProps}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  keys: <svg {...iconProps}><circle cx="7.5" cy="15.5" r="3.5" /><path d="m10 13 6-6M16 7l2.5 2.5M14 5l4 4" /></svg>,
  fallback: <svg {...iconProps}><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>,
  analytics: <svg {...iconProps}><path d="M3 3v18h18M8 17V9M13 17V5M18 17v-6" /></svg>,
  logs: <svg {...iconProps}><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  apikey: <svg {...iconProps}><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0zM12 16v6" /></svg>,
  docs: <svg {...iconProps}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
  agents: <svg {...iconProps}><path d="M8 9l3 3-3 3M13 15h3M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /></svg>,
}

const NAV = [
  { to: '/playground', label: 'Playground', key: 'playground' },
  { to: '/connect', label: 'API Key', key: 'apikey' },
  { to: '/agents', label: 'Agents', key: 'agents' },
  { to: '/keys', label: 'Keys', key: 'keys' },
  { to: '/docs', label: 'Docs', key: 'docs' },
  { to: '/fallback', label: 'Fallback', key: 'fallback' },
  { to: '/analytics', label: 'Analytics', key: 'analytics' },
  { to: '/logs', label: 'Logs', key: 'logs' },
]

function NavItem({ to, label, icon, onNavigate }: { to: string; label: string; icon: ReactNode; onNavigate: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors',
          isActive
            ? 'bg-[#5fb13a] text-[#191919]'
            : 'text-white/60 hover:bg-white/5 hover:text-white',
        )
      }
    >
      {icon}
      <span className="uppercase tracking-wide">{label}</span>
    </NavLink>
  )
}

function useDarkMode() {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark'),
  )
  useEffect(() => {
    // apex-ui is a dark-first design system — default to dark unless the user
    // explicitly chose light.
    const stored = localStorage.getItem('theme')
    if (stored !== 'light') {
      document.documentElement.classList.add('dark')
      setDark(true)
    }
  }, [])
  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }
  return { dark, toggle }
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dark, toggle } = useDarkMode()
  // Desktop app runs in local mode (no accounts) — hide "Sign out" there.
  const isDesktop = typeof window !== 'undefined' && (window as unknown as { llmpanda?: { desktop?: boolean } }).llmpanda?.desktop
  const footBtn =
    'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium uppercase tracking-wide text-white/60 transition-colors hover:bg-white/5 hover:text-white cursor-pointer'
  return (
    <aside
      className={cn(
        'apex fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/10 bg-[#191919] p-5 text-white transition-transform duration-300 lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      {/* brand → main domain home */}
      <a href="/" aria-label="LLM Panda home" className="mb-8 flex items-center gap-3 px-2 transition-opacity hover:opacity-80">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#5fb13a]">
          <img src="/panda-logo.png" alt="LLM Panda" className="size-7 object-contain" />
        </span>
        <span className="font-display text-sm font-bold uppercase tracking-wide">LLM Panda</span>
      </a>

      {/* nav */}
      <nav className="flex flex-1 flex-col gap-1.5">
        {NAV.map(n => (
          <NavItem key={n.key} to={n.to} label={n.label} icon={ICONS[n.key]} onNavigate={onClose} />
        ))}
      </nav>

      {/* footer */}
      <div className="flex flex-col gap-1 border-t border-white/10 pt-4">
        <button type="button" onClick={toggle} className={footBtn} aria-label="Toggle theme">
          {dark ? (
            <svg {...iconProps}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2m4.93-15.07 1.41 1.41M5.66 17.66l-1.41 1.41M2 12h2m16 0h2M6.34 6.34 4.93 4.93m12.73 12.73 1.41 1.41" /></svg>
          ) : (
            <svg {...iconProps}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
          )}
          <span>{dark ? 'Light mode' : 'Dark mode'}</span>
        </button>
        {!isDesktop && (
          <button type="button" onClick={() => logout()} className={footBtn} aria-label="Sign out">
            <svg {...iconProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            <span>Sign out</span>
          </button>
        )}
      </div>
    </aside>
  )
}

function MobileBar({ onOpen }: { onOpen: () => void }) {
  return (
    <header className="apex sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-[#191919] px-4 py-3 text-white lg:hidden">
      <a href="/" aria-label="LLM Panda home" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
        <span className="flex size-7 items-center justify-center rounded-full bg-[#5fb13a] font-display text-xs font-bold text-[#191919]">P</span>
        <span className="font-display text-sm font-bold uppercase tracking-wide">LLM Panda</span>
      </a>
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open menu"
        className="flex size-9 items-center justify-center rounded-full border border-white/15 text-white transition-colors hover:bg-white/5"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-5 h-5">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
    </header>
  )
}

function Layout() {
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="min-h-screen bg-background">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          aria-hidden
        />
      )}
      <div className="lg:ml-60">
        <MobileBar onOpen={() => setNavOpen(true)} />
        <main className="min-h-screen">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
            <Routes>
              <Route path="/" element={<Navigate to="/playground" replace />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/connect" element={<ApiKeyPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/keys" element={<KeysPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/fallback" element={<FallbackPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/logs" element={<RequestsPage />} />
              <Route path="/test" element={<Navigate to="/playground" replace />} />
              <Route path="/health" element={<Navigate to="/keys" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/login" element={<AuthScreen view="login" />} />
          <Route path="/register" element={<AuthScreen view="register" />} />
          <Route path="/forgot" element={<AuthScreen view="forgot" />} />
          <Route path="/verify" element={<VerifyScreen />} />
          <Route path="/reset-password" element={<ResetPasswordScreen />} />
          <Route path="/oauth" element={<OAuthCallback />} />
          <Route path="/onboarding" element={<OnboardingScreen />} />
          <Route path="/*" element={<RequireAuth><Layout /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
