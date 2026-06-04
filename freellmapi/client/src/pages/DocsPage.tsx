import { PageHeader } from '@/components/page-header'

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}
function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

interface Provider {
  name: string
  platform: string         // the id to pick on the Keys page
  url: string              // where to get the key
  steps: string[]
  note: string
  noCard?: boolean
  prefix?: string          // key prefix users should expect
}

// Each provider's API-key source + the exact steps. All are free / no-card
// unless noted. URLs verified live.
const PROVIDERS: Provider[] = [
  { name: 'Google AI Studio — Gemini', platform: 'google', url: 'https://aistudio.google.com/apikey', noCard: true, prefix: 'AIza…',
    steps: ['Sign in with a Google account', 'Click “Create API key”', 'Copy the key (starts with AIza…)'],
    note: 'Best free vision + 1M context (Gemini Flash). Generous free tier.' },
  { name: 'Groq', platform: 'groq', url: 'https://console.groq.com/keys', noCard: true, prefix: 'gsk_…',
    steps: ['Sign up (Google / GitHub / email)', 'Open “API Keys”', 'Click “Create API Key” → copy (gsk_…)'],
    note: 'Fastest tokens/sec. Llama, GPT-OSS, Kimi, and more.' },
  { name: 'Cerebras', platform: 'cerebras', url: 'https://cloud.cerebras.ai/', noCard: true,
    steps: ['Sign up', 'Go to “API Keys”', 'Generate a key → copy'],
    note: 'Ultra-fast inference (Qwen, Llama).' },
  { name: 'SambaNova Cloud', platform: 'sambanova', url: 'https://cloud.sambanova.ai/apis', noCard: true,
    steps: ['Sign up', 'Open “APIs” / “API Keys”', 'Generate a key → copy'],
    note: 'Fast Llama-4 / Llama-3 models.' },
  { name: 'NVIDIA NIM', platform: 'nvidia', url: 'https://build.nvidia.com/', noCard: true, prefix: 'nvapi-…',
    steps: ['Sign up with an NVIDIA account', 'Open any model on build.nvidia.com', 'Click “Get API Key” → copy (nvapi-…)'],
    note: 'Free credits across a big model catalog.' },
  { name: 'Mistral', platform: 'mistral', url: 'https://console.mistral.ai/api-keys', noCard: true,
    steps: ['Sign up', 'Verify your phone number (free “Experiment” tier)', '“API Keys” → “Create new key” → copy'],
    note: 'Mistral, Codestral, Magistral.' },
  { name: 'OpenRouter', platform: 'openrouter', url: 'https://openrouter.ai/keys', noCard: true, prefix: 'sk-or-…',
    steps: ['Sign up', 'Open “Keys” → “Create Key” → copy (sk-or-…)'],
    note: 'Huge catalog incl. many “:free” models (no card needed for those).' },
  { name: 'GitHub Models', platform: 'github', url: 'https://github.com/settings/personal-access-tokens', noCard: true, prefix: 'github_pat_…',
    steps: ['Use your GitHub account', 'Settings → Developer settings → Personal access tokens', 'Generate a token (fine-grained, no extra scopes) → copy'],
    note: 'GPT-4o / GPT-4.1 and more via GitHub.' },
  { name: 'Cohere', platform: 'cohere', url: 'https://dashboard.cohere.com/api-keys', noCard: true,
    steps: ['Sign up', 'Open “API Keys”', 'Use the Trial key (free, rate-limited) → copy'],
    note: 'Command models.' },
  { name: 'Cloudflare Workers AI', platform: 'cloudflare', url: 'https://dash.cloudflare.com/', noCard: true, prefix: 'accountId:token',
    steps: ['Cloudflare account → Dashboard', 'AI → Workers AI → create an API token', 'Copy the token AND your Account ID — use as “accountId:token”'],
    note: 'On the Keys page, paste the token and fill the Account ID field. Free daily neurons.' },
  { name: 'Z.ai / Zhipu (GLM)', platform: 'zhipu', url: 'https://z.ai/manage-apikey/apikey-list', noCard: true,
    steps: ['Sign up', '“API Keys” → create → copy'],
    note: 'GLM-4.x models. Free trial tokens.' },
  { name: 'Hugging Face', platform: 'huggingface', url: 'https://huggingface.co/settings/tokens', noCard: true, prefix: 'hf_…',
    steps: ['Account → Settings → Access Tokens', 'Click “New token” (Read) → copy (hf_…)'],
    note: 'Router credit; many open models.' },
  { name: 'Ollama Cloud', platform: 'ollama', url: 'https://ollama.com/settings/keys', noCard: true,
    steps: ['Sign up', 'Settings → “Keys”', 'Create a key → copy'],
    note: 'Frontier open models (GLM, Kimi…). GPU-time capped.' },
  { name: 'Together AI', platform: 'together', url: 'https://api.together.ai/settings/api-keys', noCard: true,
    steps: ['Sign up', 'Settings → “API Keys”', 'Copy your key'],
    note: 'Free “*-Free” models (Llama 3.3 70B Turbo Free, etc).' },
  { name: 'OpenCode Zen', platform: 'opencode', url: 'https://opencode.ai/', noCard: true,
    steps: ['Sign up', 'Open “Zen” → “API Keys”', 'Create a key → copy'],
    note: 'Free model pool (big-pickle, *-free).' },
]

const KEYLESS = ['kilo', 'pollinations', 'llm7']

function ProviderCard({ p }: { p: Provider }) {
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold uppercase tracking-wide">{p.name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-[#5fb13a]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#5fb13a]">Free</span>
            {p.noCard && <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/60">No card</span>}
            <span className="font-mono text-[10px] text-muted-foreground">platform: {p.platform}</span>
          </div>
        </div>
        <a
          href={p.url} target="_blank" rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#1e6602] px-4 py-2 text-xs font-medium uppercase tracking-wide text-white transition-colors hover:bg-[#27800a]"
        >
          Get key <ExternalIcon />
        </a>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-white/70 marker:text-[#5fb13a]">
        {p.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <p className="mt-3 text-[11px] text-muted-foreground">{p.note}{p.prefix ? ` · key looks like ${p.prefix}` : ''}</p>
    </div>
  )
}

export default function DocsPage() {
  return (
    <div className="apex">
      <PageHeader
        title="Get API Keys"
        eyebrow="Docs"
        icon={<BookIcon />}
        description="Every model needs a free provider key. Here's exactly where + how to get each one — all free, most need no card. Copy a key, then add it on the Keys page."
      />

      <div className="space-y-8">
        <section>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {PROVIDERS.map(p => <ProviderCard key={p.platform} p={p} />)}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">No key needed</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            These run with <span className="text-[#5fb13a]">zero setup</span> — the router uses them automatically when you haven't added any key of your own:
            <span className="ml-1 font-mono text-white/70">{KEYLESS.join(', ')}</span>. Best for trying things out (shared, rate-limited).
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">Self-hosted / custom</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Point at any OpenAI-compatible endpoint — llama.cpp, LM Studio, vLLM, a local Ollama, or a private gateway —
            on the <a href="/keys" className="text-[#5fb13a] underline">Keys</a> page under “Add a custom OpenAI-compatible model”. The API key is optional (most local servers don't need one).
          </p>
        </section>

        <section className="rounded-2xl border border-[#5fb13a]/30 bg-[#5fb13a]/[0.06] p-5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-[#5fb13a]">How to add a key</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-white/70 marker:text-[#5fb13a]">
            <li>Copy the key from the provider above.</li>
            <li>Open the <a href="/keys" className="text-[#5fb13a] underline">Keys</a> page → “Add a provider key”.</li>
            <li>Pick the matching <span className="font-mono">platform</span>, paste the key, click <span className="uppercase">Add key</span>.</li>
            <li>The router starts using it automatically (status updates after the first request / health check).</li>
          </ol>
        </section>
      </div>
    </div>
  )
}
