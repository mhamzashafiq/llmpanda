import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, setToken, getToken, UNAUTHORIZED_EVENT } from '@/lib/api'
import { Reveal } from '@/components/apex/reveal'
import { Marquee } from '@/components/apex/marquee'
import { PillButton } from '@/components/apex/pill-button'
import { SectionHeader } from '@/components/apex/section-header'
import { StatusDot } from '@/components/apex/status-dot'

interface AuthStatus {
  needsSetup: boolean
  authenticated: boolean
  email: string | null
}

/* Extruded 3D text — stacked shadows in progressively darker greens give the
   accent line depth. */
const GREEN_3D: CSSProperties = {
  color: '#5fb13a',
  textShadow:
    '0 1px 0 #4c9c2e, 0 2px 0 #438a28, 0 3px 0 #3a7822, 0 4px 0 #31661c, 0 5px 0 #285416, 0 6px 10px rgba(0,0,0,0.45)',
}

/* Rotating headline using the animate-text "mask-reveal-up" effect (per-line):
   enter rises in with a soft blur, exit lifts up + blurs out, then the next
   phrase swaps in. Driven by WAAPI (no dependency). The host has a FIXED height
   so swapping phrases never shifts the rest of the hero. */
function RotatingText({ items }: { items: string[] }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let idx = 0
    let active = true
    const anims: Animation[] = []
    const timers: number[] = []
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const S = 0.72, Y = 0.58 // site runtime: speed ×0.72, vertical travel ×0.58
    const sleep = (ms: number) => new Promise<void>(r => { timers.push(window.setTimeout(r, ms)) })
    const play = (frames: Keyframe[], dur: number, ease: string) => {
      const a = el.animate(frames, { duration: dur, easing: ease, fill: 'forwards' })
      anims.push(a)
      return a.finished.catch(() => {})
    }
    const enter = () => play(
      [{ opacity: 0, transform: `translate3d(0,${30 * Y}px,0)`, filter: 'blur(6px)' },
       { opacity: 1, transform: 'translate3d(0,0,0)', filter: 'blur(0)' }],
      760 * S, 'cubic-bezier(0.22,1,0.36,1)')
    const exit = () => play(
      [{ opacity: 1, transform: 'translate3d(0,0,0)', filter: 'blur(0)' },
       { opacity: 0, transform: `translate3d(0,${-22 * Y}px,0)`, filter: 'blur(6px)' }],
      520 * S, 'cubic-bezier(0.64,0,0.78,0)')
    el.textContent = items[0]
    void (async () => {
      if (reduce) return
      await enter()
      while (active) {
        await sleep(550); if (!active) break
        await exit(); if (!active) break
        idx = (idx + 1) % items.length
        await sleep(35)
        el.textContent = items[idx]
        await enter()
        await sleep(320)
      }
    })()
    return () => { active = false; anims.forEach(a => a.cancel()); timers.forEach(t => clearTimeout(t)) }
  }, [items.join('|')])
  return (
    <span style={{ display: 'block', height: '1.15em', lineHeight: 1.05, overflow: 'visible', perspective: '900px' }}>
      <span ref={ref} style={{ ...GREEN_3D, display: 'inline-block', whiteSpace: 'nowrap', transformOrigin: '50% 55%', backfaceVisibility: 'hidden', willChange: 'transform,opacity,filter' }} />
    </span>
  )
}

/* ── icons ───────────────────────────────────────── */
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}
function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      {off ? (
        <>
          <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.16 3.19M6.6 6.6A18 18 0 0 0 2 12s3 8 10 8a9.3 9.3 0 0 0 5.4-1.6" />
          <path d="m2 2 20 20" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      ) : (
        <>
          <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}
function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.22-3.37-1.22-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  )
}

/* ── shells ──────────────────────────────────────── */
function DarkScreen({ children }: { children: ReactNode }) {
  return (
    <div className="apex min-h-screen flex items-center justify-center bg-[#191919] text-white px-6">
      <div className="w-full max-w-sm text-center">{children}</div>
    </div>
  )
}

function BrandPanel() {
  const stats = [
    { value: '14', label: 'Providers' },
    { value: '800M+', label: 'Tokens / mo' },
    { value: 'OpenAI', label: 'Compatible' },
  ]
  return (
    <div className="relative hidden lg:flex flex-col justify-between overflow-hidden border-r border-white/10 bg-[#191919] p-12 text-white">
      {/* ghost logotype brand stamp */}
      <span
        aria-hidden
        className="font-display pointer-events-none absolute -bottom-10 -left-4 select-none text-[18vw] font-bold leading-none text-transparent opacity-[0.06]"
        style={{ WebkitTextStroke: '1px #5fb13a' }}
      >
        PANDA
      </span>

      <Reveal className="flex">
        <a href="/" aria-label="LLM Panda home" className="flex items-center gap-3 transition-opacity hover:opacity-80">
          <span className="flex size-9 items-center justify-center rounded-full bg-[#5fb13a] font-display text-base font-bold text-[#191919]">P</span>
          <span className="font-display text-sm font-bold uppercase tracking-wide">LLM Panda</span>
        </a>
      </Reveal>

      <div className="relative max-w-xl">
        <Reveal className="mb-6 flex items-center gap-2" delay={100}>
          <StatusDot status="healthy" pulse />
          <span className="text-xs uppercase tracking-widest text-[#5fb13a]">Personal Inference Proxy</span>
        </Reveal>
        <Reveal as="h1" delay={150} className="font-display text-5xl font-bold uppercase leading-[1.05] xl:text-6xl">
          One Endpoint.
          <RotatingText items={['Free LLMs.', 'No Setup.', 'Vision AI.', 'Failover.', 'No Card.', '100+ LLMs.']} />
        </Reveal>
        <Reveal as="p" delay={250} className="mt-8 max-w-md text-lg leading-relaxed text-white/60">
          Aggregate free AI providers behind one OpenAI-compatible endpoint, with local keys and
          production-grade routing.
        </Reveal>
      </div>

      <div>
        <Reveal delay={300} className="-mx-12 mb-8 border-y border-white/10 py-4">
          <Marquee items={['Aggregate', 'Route', 'Stream', 'Failover', 'Local Keys', 'OpenAI-Compatible', '14 Providers']} />
        </Reveal>
        <Reveal delay={400} className="flex items-end gap-12">
          {stats.map(s => (
            <div key={s.label}>
              <div className="font-display text-3xl font-bold text-[#5fb13a]">{s.value}</div>
              <div className="mt-1 text-xs uppercase tracking-widest text-white/40">{s.label}</div>
            </div>
          ))}
        </Reveal>
      </div>
    </div>
  )
}

/* ── auth form ───────────────────────────────────── */
function AuthForm({ view, onAuthed }: { view: 'setup' | 'login' | 'register' | 'forgot'; onAuthed: () => void }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [done, setDone] = useState(false)          // register/forgot submitted → show confirmation
  const [unverified, setUnverified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [remember, setRemember] = useState(true)
  // Lead-gen fields (register only)
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [teamSize, setTeamSize] = useState('')
  const [useCase, setUseCase] = useState('')
  const [optIn, setOptIn] = useState(true)

  const isRegister = view === 'register'
  const isForgot = view === 'forgot'
  const isLogin = view === 'login'
  const isCreate = isRegister

  // Surface an OAuth failure passed back as ?oauth_error on the login route.
  useEffect(() => {
    if (!isLogin) return
    const p = new URLSearchParams(window.location.search).get('oauth_error')
    if (!p) return
    setError(
      p === 'unconfigured' ? 'GitHub sign-in isn’t configured yet.'
        : p === 'email' ? 'Your GitHub account has no verified email — add one on GitHub and retry.'
        : 'GitHub sign-in failed. Please try again.',
    )
  }, [isLogin])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(''); setNotice(''); setUnverified(false)
    try {
      if (isForgot) {
        await apiFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
        // Always proceed to the code-entry form (no account enumeration — the
        // form is shown whether or not an account exists for that email).
        navigate(`/reset-password?email=${encodeURIComponent(email)}`)
        return
      }
      if (isRegister) {
        await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email, password,
            fullName: fullName || undefined, company: company || undefined,
            role: role || undefined, teamSize: teamSize || undefined,
            useCase: useCase || undefined, marketingOptIn: optIn,
          }),
        })
        setNotice('Account created. Check your email for a verification link, then sign in.')
        setDone(true)
        return
      }
      const res = await apiFetch<{ token: string }>('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password }),
      })
      setToken(res.token, remember)
      onAuthed()
    } catch (err) {
      const msg = (err as Error).message
      if (/verify your email/i.test(msg)) setUnverified(true)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function resendVerification() {
    setBusy(true); setError(''); setNotice('')
    try {
      await apiFetch('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) })
      setNotice('Verification email sent. Check your inbox.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-[#272727] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-colors focus:border-[#5fb13a] focus:ring-2 focus:ring-[#5fb13a]/30'
  const labelCls = 'mb-2 block text-xs font-medium uppercase tracking-wide text-white/50'

  const title = isForgot ? 'Forgot password' : isRegister ? 'Create account' : 'Welcome back'
  const subtitle = isForgot
    ? "Enter your email and we'll send a 6-digit reset code."
    : isRegister
      ? 'Register a new account — verify your email to activate it.'
      : 'Enter your credentials to access your proxy dashboard.'

  // Confirmation panel after register / forgot submit.
  if (done) {
    return (
      <>
        <Reveal><SectionHeader label="Check your email" icon={<LockIcon />} tone="dark" /></Reveal>
        <Reveal delay={80} as="h1" className="mt-6 font-display text-3xl font-bold uppercase leading-tight text-white sm:text-4xl">
          Check your inbox
        </Reveal>
        <Reveal delay={140} as="p" className="mt-3 text-sm leading-relaxed text-white/60">{notice}</Reveal>
        <Reveal delay={220}>
          <PillButton type="button" fullWidth label="Back to sign in" onClick={() => navigate('/login')} />
        </Reveal>
        {isRegister && (
          <Reveal delay={280} as="p" className="mt-6 text-center text-sm text-white/40">
            Didn't get it?{' '}
            <button type="button" onClick={resendVerification} disabled={busy}
              className="cursor-pointer font-medium text-white underline decoration-[#5fb13a] decoration-2 underline-offset-4 hover:text-[#5fb13a]">
              Resend
            </button>
          </Reveal>
        )}
      </>
    )
  }

  return (
    <>
          <Reveal>
            <SectionHeader label={isForgot ? 'Reset' : isRegister ? 'Register' : 'Sign in'} icon={<LockIcon />} tone="dark" />
          </Reveal>

          <Reveal delay={80} as="h1" className="mt-6 font-display text-3xl font-bold uppercase leading-tight text-white sm:text-4xl">
            {title}
          </Reveal>
          <Reveal delay={140} as="p" className="mt-2 text-sm leading-relaxed text-white/50">
            {subtitle}
          </Reveal>

          <Reveal delay={200}>
            <form onSubmit={submit} className="mt-8 space-y-5">
              <div>
                <label className={labelCls} htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputCls}
                />
              </div>

              {!isForgot && (
              <div>
                <label className={labelCls} htmlFor="auth-password">Password</label>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete={isCreate ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={isCreate ? 'at least 8 characters' : '••••••••'}
                    className={inputCls + ' pr-11'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-white/40 transition-colors hover:text-white"
                  >
                    <EyeIcon off={showPw} />
                  </button>
                </div>
              </div>
              )}

              {isRegister && (
                <>
                  <div>
                    <label className={labelCls} htmlFor="reg-name">Full name</label>
                    <input id="reg-name" autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Ada Lovelace" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="reg-company">Company / workspace</label>
                    <input id="reg-company" autoComplete="organization" value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme Inc." className={inputCls} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelCls} htmlFor="reg-role">Role</label>
                      <select id="reg-role" value={role} onChange={e => setRole(e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        <option>Developer</option>
                        <option>Founder / CTO</option>
                        <option>Product</option>
                        <option>Data / ML</option>
                        <option>Student</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="reg-team">Team size</label>
                      <select id="reg-team" value={teamSize} onChange={e => setTeamSize(e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        <option>Just me</option>
                        <option>2–10</option>
                        <option>11–50</option>
                        <option>51–200</option>
                        <option>200+</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="reg-usecase">Primary use case</label>
                    <select id="reg-usecase" value={useCase} onChange={e => setUseCase(e.target.value)} className={inputCls}>
                      <option value="">Select…</option>
                      <option>Personal project</option>
                      <option>Startup / MVP</option>
                      <option>Production app</option>
                      <option>Research</option>
                      <option>Internal tooling</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-white/50">
                    <input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} className="mt-0.5 size-4 cursor-pointer rounded border-white/20 accent-[#5fb13a]" />
                    <span>Send me product updates and tips. No spam, unsubscribe anytime.</span>
                  </label>
                </>
              )}

              {isLogin && (
                <div className="flex items-center justify-between text-sm">
                  <label className="group flex cursor-pointer select-none items-center gap-2.5 text-white/60">
                    <span className="relative inline-flex size-5 items-center justify-center">
                      <input
                        type="checkbox" checked={remember}
                        onChange={e => setRemember(e.target.checked)}
                        className="peer absolute inset-0 z-10 cursor-pointer opacity-0"
                      />
                      <span className="absolute inset-0 rounded-md border border-white/25 bg-[#272727] transition-all duration-200 ease-out group-hover:border-white/40 peer-checked:border-[#5fb13a] peer-checked:bg-[#5fb13a] peer-checked:[transform:scale(1.08)] peer-focus-visible:ring-2 peer-focus-visible:ring-[#5fb13a]/40" />
                      <svg viewBox="0 0 24 24" className="relative size-3.5 text-[#191919]" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
                        <path
                          d="M20 6 9 17l-5-5"
                          style={{ strokeDasharray: 26, strokeDashoffset: remember ? 0 : 26, transition: 'stroke-dashoffset .28s cubic-bezier(0.65,0,0.35,1) .04s' }}
                        />
                      </svg>
                    </span>
                    Remember me
                  </label>
                  <button type="button" onClick={() => navigate('/forgot')}
                    className="cursor-pointer font-medium text-white/40 transition-colors hover:text-[#5fb13a]">
                    Forgot password?
                  </button>
                </div>
              )}

              {notice && (
                <p className="rounded-lg border border-[#5fb13a]/30 bg-[#5fb13a]/10 px-3 py-2 text-xs text-[#5fb13a]">
                  {notice}
                </p>
              )}
              {error && (
                <p className="rounded-lg border border-[#ff4d4f]/30 bg-[#ff4d4f]/10 px-3 py-2 text-xs text-[#ff4d4f]">
                  {error}
                </p>
              )}
              {unverified && (
                <button type="button" onClick={resendVerification} disabled={busy}
                  className="w-full cursor-pointer text-xs font-medium text-[#5fb13a] underline underline-offset-4 hover:opacity-80">
                  Resend verification email
                </button>
              )}

              <PillButton
                type="submit"
                fullWidth
                label={busy
                  ? (isForgot ? 'Sending…' : isCreate ? 'Creating…' : 'Signing in…')
                  : isForgot ? 'Send code' : isCreate ? 'Create account' : 'Sign in'}
                disabled={busy || !email || (!isForgot && !password)}
              />
            </form>
          </Reveal>

          {!isForgot && (
          <Reveal delay={260}>
            <div className="my-6 flex items-center gap-4">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-xs uppercase tracking-widest text-white/40">or</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <PillButton
              variant="outlineDark"
              fullWidth
              withBadge={false}
              leadingIcon={<GithubIcon />}
              label="Continue with GitHub"
              onClick={() => { window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/auth/github` }}
            />
          </Reveal>
          )}

          <Reveal delay={320} as="p" className="mt-8 text-center text-sm text-white/50">
            {isForgot ? 'Remembered it? ' : isRegister ? 'Have an account? ' : 'New here? '}
            <button
              type="button"
              onClick={() => navigate(isRegister || isForgot ? '/login' : '/register')}
              className="cursor-pointer font-medium text-white underline decoration-[#5fb13a] decoration-2 underline-offset-4 transition-colors hover:text-[#5fb13a]"
            >
              {isRegister || isForgot ? 'Sign in' : 'Create account'} →
            </button>
          </Reveal>
    </>
  )
}

/* ── auth status ─────────────────────────────────── */
function useAuthStatus() {
  const query = useQuery<AuthStatus>({
    queryKey: ['auth-status'],
    queryFn: () => apiFetch('/api/auth/status'),
    retry: false,
  })
  useEffect(() => {
    const handler = () => { query.refetch() }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [query])
  return query
}

function LoadingScreen() {
  return (
    <DarkScreen>
      <p className="font-display text-sm uppercase tracking-widest text-white/60">Loading…</p>
    </DarkScreen>
  )
}

function ServerDownScreen() {
  return (
    <DarkScreen>
      <div className="rounded-xl border border-[#ff4d4f]/40 bg-[#ff4d4f]/10 px-4 py-3 text-sm text-[#ff4d4f]">
        Can't reach the server. Make sure the backend is running (<code className="font-mono">npm run dev</code>).
      </div>
    </DarkScreen>
  )
}

/* ── /login + /register + /forgot screen ─────────── */
export function AuthScreen({ view }: { view: 'login' | 'register' | 'forgot' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useAuthStatus()

  const from = (location.state as { from?: string } | null)?.from ?? '/playground'

  if (isLoading) return <LoadingScreen />
  if (isError || !data) return <ServerDownScreen />
  // Already signed in → bounce to the app (or wherever they were headed).
  if (data.authenticated) return <Navigate to={from} replace />

  function onAuthed() {
    queryClient.invalidateQueries()
    navigate(from, { replace: true })
  }

  return (
    <div className="apex grid min-h-screen bg-[#191919] lg:grid-cols-2">
      <BrandPanel />
      <div className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <AuthForm view={view} onAuthed={onAuthed} />
        </div>
      </div>
    </div>
  )
}

/* ── route guard for the app ─────────────────────── */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data, isLoading, isError } = useAuthStatus()

  if (isLoading) return <LoadingScreen />
  if (isError || !data) return <ServerDownScreen />
  if (!data.authenticated) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  return <>{children}</>
}

const resetInputCls =
  'w-full rounded-xl border border-white/10 bg-[#272727] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-colors focus:border-[#5fb13a] focus:ring-2 focus:ring-[#5fb13a]/30'

function BrandMark() {
  return (
    <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#5fb13a] font-display text-lg font-bold text-[#191919]">P</span>
  )
}

/* ── /verify ─────────────────────────────────────── */
export function VerifyScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<'pending' | 'ok' | 'fail'>('pending')

  useEffect(() => {
    if (!token) { setState('fail'); return }
    apiFetch('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setState('ok'))
      .catch(() => setState('fail'))
  }, [token])

  return (
    <DarkScreen>
      <BrandMark />
      <h1 className="mt-6 font-display text-2xl font-bold uppercase text-white">
        {state === 'pending' ? 'Verifying…' : state === 'ok' ? 'Email verified' : 'Link invalid'}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-white/60">
        {state === 'pending'
          ? 'One moment.'
          : state === 'ok'
            ? 'Your email is confirmed — you can sign in now.'
            : 'This verification link is invalid or has expired. Request a new one from the sign-in page.'}
      </p>
      {state !== 'pending' && (
        <div className="mt-6"><PillButton type="button" fullWidth label="Go to sign in" onClick={() => navigate('/login')} /></div>
      )}
    </DarkScreen>
  )
}

/* ── /oauth (token hand-off from a provider redirect) ── */
export function OAuthCallback() {
  const navigate = useNavigate()
  useEffect(() => {
    const hash = window.location.hash
    const m = hash.match(/token=([^&]+)/)
    if (m) {
      setToken(decodeURIComponent(m[1]), true)
      const base = import.meta.env.BASE_URL || '/'
      // New OAuth signups go to onboarding (lead capture) first, not the dashboard.
      const isNew = /[#&]new=1/.test(hash)
      window.location.replace(base + (isNew ? 'onboarding' : ''))
    } else {
      navigate('/login?oauth_error=failed', { replace: true })
    }
  }, [navigate])
  return (
    <DarkScreen>
      <BrandMark />
      <p className="mt-6 text-sm text-white/60">Signing you in…</p>
    </DarkScreen>
  )
}

/* ── /onboarding (lead capture after a fresh OAuth signup) ── */
export function OnboardingScreen() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [teamSize, setTeamSize] = useState('')
  const [useCase, setUseCase] = useState('')
  const [optIn, setOptIn] = useState(true)
  const [busy, setBusy] = useState(false)

  // Requires the session minted during the OAuth handshake. No token → login.
  useEffect(() => { if (!getToken()) navigate('/login', { replace: true }) }, [navigate])

  async function finish(send: boolean) {
    setBusy(true)
    try {
      if (send) {
        await apiFetch('/api/auth/onboarding', {
          method: 'POST',
          body: JSON.stringify({
            fullName: fullName || undefined, company: company || undefined, role: role || undefined,
            teamSize: teamSize || undefined, useCase: useCase || undefined, marketingOptIn: optIn,
          }),
        })
      }
    } catch { /* best-effort lead capture — never block entry */ }
    finally { window.location.replace(import.meta.env.BASE_URL || '/') }
  }

  const labelCls = 'mb-2 block text-xs font-medium uppercase tracking-wide text-white/50'

  return (
    <DarkScreen>
      <BrandMark />
      <h1 className="mt-6 font-display text-2xl font-bold uppercase text-white">Welcome to LLM Panda</h1>
      <p className="mt-2 text-sm text-white/50">Tell us a bit about you so we can tailor your setup. Takes 20 seconds.</p>
      <form onSubmit={e => { e.preventDefault(); finish(true) }} className="mt-6 space-y-4 text-left">
        <div>
          <label className={labelCls}>Full name</label>
          <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" className={resetInputCls} />
        </div>
        <div>
          <label className={labelCls}>Company / workspace</label>
          <input autoComplete="organization" value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme Inc." className={resetInputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Role</label>
            <select value={role} onChange={e => setRole(e.target.value)} className={resetInputCls}>
              <option value="">Select…</option>
              <option>Developer</option><option>Founder / CTO</option><option>Product</option>
              <option>Data / ML</option><option>Student</option><option>Other</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Team size</label>
            <select value={teamSize} onChange={e => setTeamSize(e.target.value)} className={resetInputCls}>
              <option value="">Select…</option>
              <option>Just me</option><option>2–10</option><option>11–50</option><option>51–200</option><option>200+</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>What will you build?</label>
          <select value={useCase} onChange={e => setUseCase(e.target.value)} className={resetInputCls}>
            <option value="">Select…</option>
            <option>Personal project</option><option>Startup / MVP</option><option>Production app</option>
            <option>Research</option><option>Just exploring</option>
          </select>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-white/60">
          <input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} className="mt-0.5 size-4 cursor-pointer rounded border-white/20 accent-[#5fb13a]" />
          Send me product updates and tips (no spam).
        </label>
        <PillButton type="submit" fullWidth label={busy ? 'Saving…' : 'Continue to dashboard'} disabled={busy} />
      </form>
      <p className="mt-4 text-center text-sm text-white/40">
        <button type="button" onClick={() => finish(false)} disabled={busy}
          className="cursor-pointer font-medium text-white/60 underline decoration-white/20 underline-offset-4 hover:text-white">
          Skip for now
        </button>
      </p>
    </DarkScreen>
  )
}

/* ── /reset-password (OTP code → new password) ────── */
export function ResetPasswordScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [codeStatus, setCodeStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')

  const labelCls = 'mb-2 block text-xs font-medium uppercase tracking-wide text-white/50'

  // Auto-verify the code as it's typed: once it's a complete 6–8 digit code and
  // the email looks valid, debounce a non-consuming check and tint the field
  // green (valid) or red (invalid).
  useEffect(() => {
    const c = code.trim()
    if (!/^\d{6,8}$/.test(c) || !/\S+@\S+\.\S+/.test(email.trim())) { setCodeStatus('idle'); return }
    let cancelled = false
    setCodeStatus('checking')
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<{ valid: boolean }>('/api/auth/verify-reset-code', {
          method: 'POST', body: JSON.stringify({ email: email.trim(), code: c }),
        })
        if (!cancelled) setCodeStatus(r.valid ? 'valid' : 'invalid')
      } catch {
        if (!cancelled) setCodeStatus('invalid')
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [code, email])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setNotice('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code: code.trim(), password }),
      })
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError(''); setNotice('')
    if (!email.trim()) { setError('Enter your email first.'); return }
    setBusy(true)
    try {
      await apiFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: email.trim() }) })
      setNotice('A new code is on its way. Check your email.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <DarkScreen>
        <BrandMark />
        <h1 className="mt-6 font-display text-2xl font-bold uppercase text-white">Password reset</h1>
        <p className="mt-3 text-sm text-white/60">Your password has been updated. Sign in with your new password.</p>
        <div className="mt-6"><PillButton type="button" fullWidth label="Go to sign in" onClick={() => navigate('/login')} /></div>
      </DarkScreen>
    )
  }

  const canSubmit = !busy && codeStatus === 'valid' && password.length >= 8 && password === confirm

  return (
    <DarkScreen>
      <BrandMark />
      <h1 className="mt-6 font-display text-2xl font-bold uppercase text-white">Set a new password</h1>
      <p className="mt-2 text-sm text-white/50">Enter the 6-digit code we emailed you, then choose a new password.</p>
      <form onSubmit={submit} className="mt-6 space-y-4 text-left">
        <div>
          <label className={labelCls}>Email</label>
          <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com" className={resetInputCls} />
        </div>
        <div>
          <label className={labelCls}>Verification code</label>
          <div className="relative">
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="6-digit code"
              className={`${resetInputCls} pr-11 text-center font-mono text-lg tracking-[0.5em] transition-colors ${
                codeStatus === 'valid' ? 'border-[#5fb13a] ring-2 ring-[#5fb13a]/40'
                  : codeStatus === 'invalid' ? 'border-[#ff4d4f] ring-2 ring-[#ff4d4f]/40'
                  : ''
              }`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              {codeStatus === 'checking' && (
                <svg className="size-5 animate-spin text-white/40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              )}
              {codeStatus === 'valid' && (
                <svg className="size-5 text-[#5fb13a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              )}
              {codeStatus === 'invalid' && (
                <svg className="size-5 text-[#ff4d4f]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              )}
            </span>
          </div>
          {codeStatus === 'invalid' && <p className="mt-1.5 text-xs text-[#ff4d4f]">Code is incorrect or expired.</p>}
          {codeStatus === 'valid' && <p className="mt-1.5 text-xs text-[#5fb13a]">Code verified.</p>}
        </div>
        <div>
          <label className={labelCls}>New password</label>
          <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="At least 8 characters" className={resetInputCls} />
        </div>
        <div>
          <label className={labelCls}>Confirm password</label>
          <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Re-enter new password"
            className={`${resetInputCls} ${confirm && confirm !== password ? 'border-[#ff4d4f]/60' : ''}`} />
        </div>
        {error && (
          <p className="rounded-lg border border-[#ff4d4f]/30 bg-[#ff4d4f]/10 px-3 py-2 text-xs text-[#ff4d4f]">{error}</p>
        )}
        {notice && (
          <p className="rounded-lg border border-[#5fb13a]/30 bg-[#5fb13a]/10 px-3 py-2 text-xs text-[#5fb13a]">{notice}</p>
        )}
        <PillButton type="submit" fullWidth label={busy ? 'Saving…' : 'Reset password'} disabled={!canSubmit} />
      </form>
      <p className="mt-5 text-center text-sm text-white/40">
        Didn't get a code?{' '}
        <button type="button" onClick={resend} disabled={busy}
          className="cursor-pointer font-medium text-white underline decoration-[#5fb13a] decoration-2 underline-offset-4 hover:text-[#5fb13a]">
          Resend
        </button>
      </p>
    </DarkScreen>
  )
}
