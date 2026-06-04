import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Reveal } from '@/components/apex/reveal'
import { PillButton } from '@/components/apex/pill-button'

/* brand greens */
const ACCENT = '#1e6602'       // deep — solid surfaces
const ACCENT_TEXT = '#5fb13a'  // bright — readable accent on dark

/* ── icons ──────────────────────────────────────────── */
const ic = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
function IKey() { return <svg viewBox="0 0 24 24" {...ic} className="size-5"><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.5 12.5 6.5-6.5M18 4l2 2M14 8l2 2" /></svg> }
function IRoute() { return <svg viewBox="0 0 24 24" {...ic} className="size-5"><circle cx="6" cy="19" r="3" /><circle cx="18" cy="5" r="3" /><path d="M6 16V8a4 4 0 0 1 4-4h5M18 8v8a4 4 0 0 1-4 4H9" /></svg> }
function ILock() { return <svg viewBox="0 0 24 24" {...ic} className="size-5"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg> }
function IBolt() { return <svg viewBox="0 0 24 24" {...ic} className="size-5"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg> }
function IChart() { return <svg viewBox="0 0 24 24" {...ic} className="size-5"><path d="M3 3v18h18M8 17V9M13 17V5M18 17v-6" /></svg> }
function IShield() { return <svg viewBox="0 0 24 24" {...ic} className="size-5"><path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg> }
function IArrow() { return <svg viewBox="0 0 24 24" {...ic} className="size-4"><path d="M5 12h14M13 6l6 6-6 6" /></svg> }
function ICheck() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="size-3.5"><path d="M20 6 9 17l-5-5" /></svg> }
function IChevrons() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="size-4"><path d="M5 5l7 7-7 7M12 5l7 7-7 7" /></svg> }

/* Extruded 3D accent text — stacked darker-green shadows give depth. */
const GREEN_3D: CSSProperties = {
  color: ACCENT_TEXT,
  textShadow:
    '0 1px 0 #4c9c2e, 0 2px 0 #438a28, 0 3px 0 #3a7822, 0 4px 0 #31661c, 0 5px 0 #285416, 0 6px 10px rgba(0,0,0,0.45)',
}

/* Rotating headline — animate-text "mask-reveal-up" (per-line): each phrase rises
   in with a soft blur, lifts out + blurs, then the next swaps in. WAAPI-driven.
   FIXED-height host so phrase swaps never shift the hero below. */
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
    const S = 0.72, Y = 0.58
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

function Eyebrow({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-xs uppercase tracking-[0.25em]" style={{ color: ACCENT_TEXT }}>
      <span className="size-2 rounded-full" style={{ backgroundColor: ACCENT_TEXT }} />{label}
    </span>
  )
}

/* ── count-up stat ── */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } }, { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { ref, inView }
}
function Stat({ to, decimals = 0, suffix = '', label }: { to: number; decimals?: number; suffix?: string; label: string }) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!inView) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1300)
      setV(to * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, to])
  return (
    <div ref={ref}>
      <div className="font-display text-3xl font-bold tabular-nums" style={{ color: ACCENT_TEXT }}>{v.toFixed(decimals)}{suffix}</div>
      <div className="mt-1 text-xs uppercase tracking-widest text-white/40">{label}</div>
    </div>
  )
}

/* ── product mock (hero visual) ── */
function HeroMock() {
  return (
    <div className="lp-float relative">
      <div className="absolute -inset-4 -z-10 rounded-[28px] opacity-40 blur-2xl" style={{ background: `radial-gradient(circle at 70% 30%, rgba(30,102,2,0.6), transparent 70%)` }} />
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0c] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <span className="size-3 rounded-full bg-white/15" /><span className="size-3 rounded-full bg-white/15" /><span className="size-3 rounded-full" style={{ backgroundColor: ACCENT_TEXT }} />
          <span className="ml-2 font-mono text-xs text-white/40">llmpanda · auto-router</span>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: ACCENT_TEXT }}>
            <span className="lp-blink size-1.5 rounded-full" style={{ backgroundColor: ACCENT_TEXT }} /> live
          </span>
        </div>
        <div className="space-y-4 p-5">
          <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-tr-sm bg-white/10 px-4 py-2.5 text-sm text-white/85">
            Summarize transformers in one line.
          </div>
          <div className="w-fit max-w-[88%] rounded-2xl rounded-tl-sm border border-white/10 bg-[#161616] px-4 py-2.5 text-sm leading-relaxed text-white/75">
            Neural nets that weigh every token against every other to model context — the backbone of modern LLMs.
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4 text-[11px]">
            <span className="rounded-full px-2.5 py-1 font-medium text-white" style={{ backgroundColor: ACCENT }}>routed: groq · llama-3.1-8b</span>
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-white/60">240&thinsp;ms</span>
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-white/60">tok 38</span>
            <span className="ml-auto flex items-center gap-1.5 text-white/45"><span className="size-1.5 rounded-full" style={{ backgroundColor: ACCENT_TEXT }} />16 providers ready</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const FEATURES = [
  { icon: <IKey />, title: 'One unified key', body: 'A single OpenAI-compatible endpoint for every app. Point any SDK at our base URL and ship — no per-provider plumbing.' },
  { icon: <IRoute />, title: 'Smart routing + fallback', body: 'Requests auto-route across providers by reliability, speed and budget. Rate-limited or down? It fails over instantly.' },
  { icon: <ILock />, title: 'BYOK, encrypted', body: 'Bring your own free-tier keys. Stored with AES-256-GCM envelope encryption — a per-org key, never in plaintext.' },
  { icon: <IBolt />, title: 'Streaming + Responses', body: 'Full SSE streaming and an OpenAI Responses shim. Works with Codex, Continue, opencode and the OpenAI SDKs.' },
  { icon: <IChart />, title: 'Analytics + logs', body: 'Per-request latency, tokens, success rate and a live request log — scoped to your org, nobody else’s.' },
  { icon: <IShield />, title: 'Multi-tenant by design', body: 'Strict org isolation: your keys, usage and logs are yours alone. Per-org quotas, audit log and GDPR export/delete.' },
]
const STEPS = [
  { n: '01', title: 'Create your account', body: 'Sign up free and verify your email — your isolated workspace is ready in seconds.' },
  { n: '02', title: 'Add your free keys', body: 'Paste your free-tier provider keys (Gemini, Groq, Cerebras, Mistral…). They’re encrypted at rest.' },
  { n: '03', title: 'Call one endpoint', body: 'Use model "auto" and the router picks the best available model — with automatic fallback.' },
]
const PROVIDERS = ['Gemini', 'OpenRouter', 'Groq', 'Cerebras', 'Mistral', 'GitHub Models', 'SambaNova', 'Cohere', 'Cloudflare', 'Z.ai', 'NVIDIA', 'HuggingFace', 'Together AI', 'OpenCode Zen']

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="apex min-h-screen overflow-x-hidden bg-[#0d0d0d] text-white">
      <style>{`
        @keyframes lpglow { 0%,100% { opacity:.4; transform:translateX(-50%) scale(1) } 50% { opacity:.75; transform:translateX(-50%) scale(1.12) } }
        @keyframes lpmarquee { from { transform:translateX(0) } to { transform:translateX(-50%) } }
        @keyframes lpfloat { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-8px) } }
        @keyframes lpblink { 0%,100% { opacity:1 } 50% { opacity:.25 } }
        .lp-float { animation: lpfloat 6s ease-in-out infinite }
        .lp-blink { animation: lpblink 1.6s ease-in-out infinite }
        .lp-marquee:hover { animation-play-state: paused }
        .lp-nav a { position:relative }
        .lp-nav a::after { content:''; position:absolute; left:0; bottom:-4px; height:2px; width:0; background:${ACCENT_TEXT}; transition:width .3s ease }
        .lp-nav a:hover::after { width:100% }
        .lp-cta .chev { position:absolute; transition: transform .3s ease }
        .lp-cta .c2 { transform: translateX(-230%) }
        .lp-cta:hover .c1 { transform: translateX(230%) }
        .lp-cta:hover .c2 { transform: translateX(0) }
        @keyframes lprotate { 0% { opacity:0; transform:rotateX(-92deg) translateY(0.22em) scale(.96) } 45% { opacity:1 } 100% { opacity:1; transform:rotateX(0) translateY(0) scale(1) } }
        .lp-rotate-wrap { display:inline-block; perspective:900px; perspective-origin:50% 50% }
        .lp-rotate { display:inline-block; transform-origin:50% 0; transform-style:preserve-3d; backface-visibility:hidden; animation: lprotate .7s cubic-bezier(0.2,0.7,0.2,1) both }
        @media (prefers-reduced-motion: reduce) { .lp-rotate { animation: none } }
        html { scroll-behavior: smooth }
      `}</style>

      {/* ── navbar ── */}
      <header className="sticky top-4 z-50 mx-auto max-w-7xl px-4">
        <nav className="flex items-center justify-between rounded-full border border-white/10 bg-black/50 px-4 py-2.5 backdrop-blur-md">
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full font-display text-sm font-bold text-white" style={{ backgroundColor: ACCENT }}>P</span>
            <span className="font-display text-sm font-bold uppercase tracking-wide">LLM Panda</span>
          </button>
          <div className="lp-nav hidden items-center gap-8 text-sm text-white/70 md:flex">
            <a href="#features" className="transition-colors hover:text-white">Features</a>
            <a href="#how" className="transition-colors hover:text-white">How it works</a>
            <a href="#security" className="transition-colors hover:text-white">Security</a>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/login')} className="hidden rounded-full px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:text-white sm:block">Sign in</button>
            <PillButton label="Get started" onClick={() => navigate('/register')} />
          </div>
        </nav>
      </header>

      {/* ── hero (split) ── */}
      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-1/2 top-0 size-[720px] rounded-full blur-[140px]" style={{ background: `radial-gradient(circle, rgba(30,102,2,0.38), transparent 70%)`, animation: 'lpglow 8s ease-in-out infinite' }} />
          <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1px)', backgroundSize: '32px 32px', WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 35%, transparent 78%)', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 35%, transparent 78%)' }} />
        </div>

        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-10 pt-10 lg:grid-cols-2 lg:pb-14 lg:pt-12">
          <div>
            <Reveal><Eyebrow label="16 providers · 100+ models" /></Reveal>
            <Reveal as="h1" delay={80} className="mt-6 font-display text-5xl font-bold uppercase leading-[1.03] sm:text-6xl xl:text-7xl">
              One key.
              <RotatingText items={['Every LLM.', 'No setup.', 'Vision AI.', 'Failover.', 'No card.', '100+ LLMs.']} />
            </Reveal>
            <Reveal as="p" delay={150} className="mt-6 max-w-md text-lg leading-relaxed text-white/60">
              A single OpenAI-compatible endpoint that routes across every credible free-tier provider —
              bring your own keys, get smart fallback, streaming and strict per-org isolation.
            </Reveal>
            <Reveal delay={230} className="mt-8 flex flex-wrap items-center gap-3">
              <PillButton label="Start for free" onClick={() => navigate('/register')} />
              <button onClick={() => navigate('/login')} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-white transition-colors hover:border-white/40">
                Sign in <IArrow />
              </button>
            </Reveal>
            <Reveal delay={300} className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/50">
              {['No credit card', 'Bring your own keys', 'OpenAI-compatible'].map(t => (
                <span key={t} className="inline-flex items-center gap-2"><span style={{ color: ACCENT_TEXT }}><ICheck /></span>{t}</span>
              ))}
            </Reveal>
          </div>

          <Reveal delay={200}><HeroMock /></Reveal>
        </div>

        {/* stats strip */}
        <div className="mx-auto max-w-7xl px-6 pb-20">
          <Reveal className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-4">
            <div className="bg-[#111] px-6 py-7 text-center"><Stat to={1.7} decimals={1} suffix="B" label="free tokens / mo" /></div>
            <div className="bg-[#111] px-6 py-7 text-center"><Stat to={16} label="providers" /></div>
            <div className="bg-[#111] px-6 py-7 text-center"><Stat to={100} suffix="+" label="models" /></div>
            <div className="bg-[#111] px-6 py-7 text-center">
              <div className="font-display text-3xl font-bold" style={{ color: ACCENT_TEXT }}>OpenAI</div>
              <div className="mt-1 text-xs uppercase tracking-widest text-white/40">compatible</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── features ── */}
      <section id="features" className="border-t border-white/5 bg-[#0d0d0d] py-[110px]">
        <div className="mx-auto max-w-7xl px-6">
          <Reveal><Eyebrow label="Features" /></Reveal>
          <Reveal as="h2" delay={80} className="mt-6 max-w-2xl font-display text-4xl font-bold uppercase leading-tight md:text-5xl">Built for builders, secured for teams</Reveal>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 80}>
                <div className="group h-full rounded-2xl border border-white/5 bg-[#161616] p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-white/10 hover:bg-[#1e1e1e]">
                  <div className="flex size-11 items-center justify-center rounded-full bg-white/5 transition-transform duration-300 group-hover:scale-110" style={{ color: ACCENT_TEXT }}>{f.icon}</div>
                  <h3 className="mt-5 font-display text-lg font-bold uppercase">{f.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-white/55">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── providers marquee ── */}
      <section className="border-y border-white/5 bg-[#141414] py-14">
        <p className="mb-8 text-center text-xs uppercase tracking-[0.3em] text-white/35">Routes across</p>
        <div className="relative overflow-hidden">
          <div className="lp-marquee flex w-max gap-12 whitespace-nowrap" style={{ animation: 'lpmarquee 45s linear infinite' }}>
            {[...PROVIDERS, ...PROVIDERS].map((p, i) => (
              <span key={i} className="flex items-center gap-12 font-display text-xl font-bold uppercase text-white/35">
                {p}<span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: ACCENT_TEXT }} />
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── how it works ── */}
      <section id="how" className="bg-[#0d0d0d] py-[110px]">
        <div className="mx-auto max-w-7xl px-6">
          <Reveal><Eyebrow label="How it works" /></Reveal>
          <Reveal as="h2" delay={80} className="mt-6 max-w-2xl font-display text-4xl font-bold uppercase leading-tight md:text-5xl">Live in three steps</Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <div className="h-full rounded-2xl border border-white/10 p-8">
                  <div className="font-display text-5xl font-bold" style={{ color: 'rgba(95,177,58,0.35)' }}>{s.n}</div>
                  <h3 className="mt-4 font-display text-xl font-bold uppercase">{s.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/55">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── security ── */}
      <section id="security" className="border-y border-white/5 bg-[#141414] py-[110px]">
        <div className="mx-auto max-w-7xl px-6">
          <Reveal><Eyebrow label="Security" /></Reveal>
          <div className="mt-8 grid gap-12 lg:grid-cols-2 lg:items-center">
            <Reveal as="h2" className="font-display text-4xl font-bold uppercase leading-tight md:text-5xl">Your keys.<br />Your data.<br />Yours alone.</Reveal>
            <Reveal delay={120} as="div" className="space-y-5">
              {[
                ['Envelope encryption', 'Provider keys are sealed with a per-org data key, itself wrapped by a master key kept outside the database. A DB leak reveals nothing usable.'],
                ['True tenant isolation', 'Every query is scoped to your organization. No user can read or use another org’s keys, analytics or logs — verified, not assumed.'],
                ['Compliance built in', 'Audit log of sensitive actions, one-click GDPR data export, and full account erasure on request.'],
              ].map(([t, d]) => (
                <div key={t} className="flex gap-4">
                  <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: ACCENT }}><IShield /></div>
                  <div>
                    <h3 className="font-display text-base font-bold uppercase">{t}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-white/55">{d}</p>
                  </div>
                </div>
              ))}
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-[100px]" style={{ backgroundColor: ACCENT }}>
        <div className="mx-auto max-w-3xl px-6 text-center">
          <Reveal as="h2" className="font-display text-4xl font-bold uppercase leading-tight text-white md:text-6xl">Start routing for free</Reveal>
          <Reveal as="p" delay={100} className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-white/80">One key, every free LLM. No credit card. Bring your own provider keys and go.</Reveal>
          <Reveal delay={180} className="mt-9 flex justify-center">
            <button onClick={() => navigate('/register')} className="lp-cta group inline-flex items-center gap-4 rounded-full bg-white py-2 pl-8 pr-2 text-sm font-bold uppercase tracking-wide text-[#191919] transition-transform hover:scale-[1.02]">
              Create your account
              <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-full text-white" style={{ backgroundColor: ACCENT }}>
                <span className="chev c1"><IChevrons /></span>
                <span className="chev c2"><IChevrons /></span>
              </span>
            </button>
          </Reveal>
        </div>
      </section>

      {/* ── footer ── */}
      <footer className="relative overflow-hidden bg-[#0a0a0a] pt-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-10 pb-12 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-full font-display text-sm font-bold text-white" style={{ backgroundColor: ACCENT }}>P</span>
                <span className="font-display text-sm font-bold uppercase tracking-wide">LLM Panda</span>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/45">One OpenAI-compatible key for every free LLM provider. Bring your own keys; we route the rest.</p>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-widest text-white/40">Product</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-white/55">
                <li><a href="#features" className="hover:text-white">Features</a></li>
                <li><a href="#how" className="hover:text-white">How it works</a></li>
                <li><button onClick={() => navigate('/register')} className="hover:text-white">Get started</button></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-widest text-white/40">Legal</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-white/55">
                <li><button onClick={() => navigate('/privacy')} className="hover:text-white">Privacy Policy</button></li>
                <li><button onClick={() => navigate('/terms')} className="hover:text-white">Terms of Service</button></li>
                <li><button onClick={() => navigate('/login')} className="hover:text-white">Sign in</button></li>
              </ul>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 py-7 text-xs text-white/40 sm:flex-row">
            <span>© {new Date().getFullYear()} LLM Panda. All rights reserved.</span>
            <span>One key. Every free LLM.</span>
          </div>
        </div>
        <div aria-hidden className="pointer-events-none select-none text-center font-display text-[18vw] font-bold uppercase leading-none text-transparent" style={{ WebkitTextStroke: '1px rgba(30,102,2,0.4)' }}>
          LLM PANDA
        </div>
      </footer>
    </div>
  )
}
