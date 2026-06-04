import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

const UPDATED = 'June 2026'
const CONTACT = 'support@llmpanda.io'

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate()
  useEffect(() => { window.scrollTo(0, 0) }, [])
  return (
    <div className="apex min-h-screen bg-[#191919] text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#191919]/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-[#5fb13a] font-display text-sm font-bold text-[#191919]">P</span>
            <span className="font-display text-sm font-bold uppercase tracking-wide">LLM Panda</span>
          </button>
          <button onClick={() => navigate('/')} className="text-sm text-white/60 transition-colors hover:text-[#5fb13a]">← Back home</button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-xs uppercase tracking-widest text-[#5fb13a]">Legal</p>
        <h1 className="mt-3 font-display text-4xl font-bold uppercase leading-tight md:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-white/40">Last updated: {UPDATED}</p>
        <div className="legal mt-10 space-y-7 text-[15px] leading-relaxed text-white/70">{children}</div>
        <div className="mt-14 border-t border-white/10 pt-6 text-sm text-white/40">
          Questions? Email <a href={`mailto:${CONTACT}`} className="text-[#5fb13a]">{CONTACT}</a>.
        </div>
      </main>

      <style>{`
        .legal h2 { font-family:'Unbounded',sans-serif; text-transform:uppercase; font-weight:700;
          font-size:1.05rem; letter-spacing:.3px; color:#fff; margin-top:.5rem; }
        .legal ul { list-style:none; padding:0; margin:.5rem 0; }
        .legal li { position:relative; padding-left:1.1rem; margin:.4rem 0; }
        .legal li::before { content:''; position:absolute; left:0; top:.6rem; width:.4rem; height:.4rem;
          border-radius:9999px; background:#5fb13a; }
        .legal strong { color:#fff; }
      `}</style>
    </div>
  )
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return <section><h2>{heading}</h2><div className="mt-2 space-y-3">{children}</div></section>
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>This Privacy Policy explains what information LLM Panda collects, how we use it, and the choices you have. By using LLM Panda you agree to this policy.</p>

      <Section heading="Information we collect">
        <ul>
          <li><strong>Account information</strong> — your email address and password (stored only as a salted hash).</li>
          <li><strong>Profile / signup details</strong> — optional fields you provide such as name, company, role, team size and use case.</li>
          <li><strong>Provider API keys</strong> — the third-party LLM keys you add are encrypted at rest with AES-256-GCM envelope encryption (a per-organization data key, itself wrapped by a master key held outside the database). We never store them in plaintext and never display them in full.</li>
          <li><strong>Usage metadata</strong> — for each request routed through the proxy we record the model, provider, status, latency and token counts so you can see your analytics and logs. Request and response message content is not persisted.</li>
        </ul>
      </Section>

      <Section heading="How we use it">
        <ul>
          <li>To operate the service: authenticate you, route your requests, enforce quotas and show your analytics.</li>
          <li>To secure your account and prevent abuse.</li>
          <li>To contact you about your account, security, and (only if you opt in) product updates.</li>
        </ul>
      </Section>

      <Section heading="Tenant isolation">
        <p>LLM Panda is multi-tenant. Your keys, usage and logs are scoped to your organization and are not accessible to other users or organizations.</p>
      </Section>

      <Section heading="Third parties">
        <p>When you make a request, your prompt is sent to the upstream LLM provider <strong>using your own keys</strong>, subject to that provider’s terms and privacy policy. We do not sell your personal data. We use a reverse proxy and error-monitoring provider strictly to operate the service.</p>
      </Section>

      <Section heading="Data retention & your rights">
        <ul>
          <li>You can export all of your organization’s data at any time from the dashboard.</li>
          <li>You can permanently delete your account and all associated data (GDPR erasure).</li>
          <li>Usage metadata is pruned on a rolling basis.</li>
        </ul>
      </Section>

      <Section heading="Cookies">
        <p>We use a single session token stored in your browser to keep you signed in. We do not use third-party advertising or tracking cookies.</p>
      </Section>

      <Section heading="Changes">
        <p>We may update this policy; material changes will be reflected by the “last updated” date above.</p>
      </Section>
    </LegalLayout>
  )
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <p>These Terms govern your use of LLM Panda. By creating an account or using the service you agree to them.</p>

      <Section heading="The service">
        <p>LLM Panda is an OpenAI-compatible proxy that routes your requests across free-tier LLM providers using API keys you supply (“bring your own keys”). We provide the routing, management and metering layer; we do not provide the underlying models.</p>
      </Section>

      <Section heading="Your account">
        <ul>
          <li>You are responsible for safeguarding your credentials and your API keys.</li>
          <li>You must provide a valid email and verify it to activate your account.</li>
          <li>You are responsible for all activity under your account and organization.</li>
        </ul>
      </Section>

      <Section heading="Acceptable use">
        <ul>
          <li>You must comply with the terms of service of every upstream provider whose keys you use.</li>
          <li>Bring your own keys only — do not attempt to pool, resell or abuse providers’ free tiers in violation of their terms.</li>
          <li>No unlawful, abusive, infringing, or harmful use, and no attempts to breach the security or isolation of the service.</li>
        </ul>
      </Section>

      <Section heading="Availability & no warranty">
        <p>The service is provided “as is”, without warranties of any kind. Free-tier providers may rate-limit, change or discontinue access at any time, and LLM Panda cannot guarantee uninterrupted availability or any particular model’s output.</p>
      </Section>

      <Section heading="Limitation of liability">
        <p>To the maximum extent permitted by law, LLM Panda is not liable for any indirect, incidental or consequential damages, or for any loss arising from upstream providers, your own keys, or your use of the service.</p>
      </Section>

      <Section heading="Termination">
        <p>You may delete your account at any time. We may suspend or terminate accounts that violate these Terms or put the service or other tenants at risk.</p>
      </Section>

      <Section heading="Changes">
        <p>We may update these Terms; continued use after changes constitutes acceptance. The “last updated” date above reflects the current version.</p>
      </Section>
    </LegalLayout>
  )
}
