import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PillButton } from '@/components/apex/pill-button'
import { PageHeader } from '@/components/page-header'

function PlugIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0zM12 16v6" />
    </svg>
  )
}

function UnifiedKeyCard() {
  const queryClient = useQueryClient()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data, isError } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const regenerate = useMutation({
    mutationFn: () => apiFetch('/api/settings/api-key/regenerate', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unified-key'] }),
  })

  const apiKey = data?.apiKey ?? ''
  const masked = apiKey ? apiKey.slice(0, 13) + '•'.repeat(32) : '…'
  const baseUrl = import.meta.env.DEV
    ? `http://${window.location.hostname}:3001/v1`
    : `${window.location.origin}/v1`

  function copy() {
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">Your unified API key</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Use this as your OpenAI <code className="font-mono">api_key</code>; it authenticates requests to this proxy.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending || isError}>
          Regenerate
        </Button>
      </div>

      {isError ? (
        <div className="rounded-lg border border-[#ff4d4f]/40 bg-[#ff4d4f]/10 px-3 py-2.5 text-xs text-[#ff4d4f]">
          Can't reach the server. Make sure the backend is running — <code className="font-mono">npm run dev</code> starts both.
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all truncate rounded-xl border border-white/10 bg-[#272727] px-3 py-2 font-mono text-xs tabular-nums">
            {showKey ? apiKey : masked}
          </code>
          <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'}</Button>
          <Button variant="outline" size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Base URL</span>
        <code className="font-mono">{baseUrl}</code>
        <span className="text-muted-foreground">Endpoint</span>
        <code className="font-mono">/v1/chat/completions</code>
      </div>
    </section>
  )
}

interface ClientKey {
  id: number
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

function ClientKeysCard() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [freshKey, setFreshKey] = useState<{ name: string; key: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: keys = [] } = useQuery<ClientKey[]>({
    queryKey: ['client-keys'],
    queryFn: () => apiFetch('/api/settings/clients'),
  })

  const create = useMutation({
    mutationFn: (n: string) => apiFetch<{ id: number; name: string; key: string }>('/api/settings/clients', {
      method: 'POST', body: JSON.stringify({ name: n }),
    }),
    onSuccess: (res) => {
      setFreshKey({ name: res.name, key: res.key })
      setName('')
      queryClient.invalidateQueries({ queryKey: ['client-keys'] })
    },
  })

  const revoke = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/settings/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-keys'] }),
  })

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">Client API keys</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Create multiple named keys (one per app / environment) and revoke them independently. The full key is shown
          once at creation.
        </p>
      </div>

      {freshKey && (
        <div className="mb-3 rounded-lg border border-[#5fb13a]/40 bg-[#5fb13a]/10 px-3 py-2.5">
          <p className="mb-1.5 text-xs font-medium text-[#5fb13a]">
            New key “{freshKey.name}” — copy it now, it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">{freshKey.key}</code>
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(freshKey.key); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFreshKey(null)}>Done</Button>
          </div>
        </div>
      )}

      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()) }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. production, staging)"
          className="flex-1 rounded-xl border border-white/10 bg-[#272727] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#5fb13a] focus:ring-2 focus:ring-[#5fb13a]/30"
        />
        <PillButton type="submit" label={create.isPending ? 'Creating…' : 'Create key'} disabled={!name.trim() || create.isPending} />
      </form>

      {keys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No client keys yet.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{k.name}</span>
                  {k.revokedAt
                    ? <span className="rounded-full bg-[#ff4d4f]/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#ff4d4f]">Revoked</span>
                    : <span className="rounded-full bg-[#5fb13a]/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#5fb13a]">Active</span>}
                </div>
                <code className="font-mono text-xs text-muted-foreground">{k.keyPrefix}••••••</code>
                <span className="ml-2 text-[11px] text-muted-foreground">
                  {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}
                </span>
              </div>
              {!k.revokedAt && (
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(k.id)} disabled={revoke.isPending}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Data backup. Desktop (local mode) → the full local database. Hosted → the
// caller's own org data only (keys masked) via the GDPR export. Both download a
// JSON file; the fetch carries the auth token, which a plain <a download> can't.
function BackupCard() {
  const isDesktop = typeof window !== 'undefined' && (window as unknown as { llmpanda?: { desktop?: boolean } }).llmpanda?.desktop
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const data = await apiFetch<unknown>(isDesktop ? '/api/account/backup' : '/api/account/export')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `llmpanda-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch { /* surfaced by global handler */ }
    finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border bg-card p-5">
      <h2 className="font-display text-sm font-bold uppercase tracking-wide">{isDesktop ? 'Local data' : 'Your data'}</h2>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {isDesktop
          ? <>Download a complete backup of your local database — keys, models, logs, and settings — as one JSON file. Restoring also needs your <code className="text-white/70">encryption.key</code>.</>
          : <>Download a backup of your account data — provider keys (masked), client keys, models, fallback chain, recent request logs, and audit trail — as one JSON file.</>}
      </p>
      <div className="mt-4">
        <PillButton onClick={download} disabled={busy} label={busy ? 'Preparing…' : 'Download backup'} />
      </div>
    </div>
  )
}

// The reusable "give this to any AI" integration system prompt, with the live
// base URL injected. The key stays a placeholder on purpose — users must keep
// it server-side, not paste the real key into an AI.
function buildIntegrationPrompt(baseUrl: string): string {
  return `You are integrating the LLM Panda API into the user's application. LLM Panda is a drop-in, OpenAI-compatible LLM gateway: ONE API key + ONE base URL routes across many AI models with automatic fallback, streaming, tool calls, and vision. If the code already uses OpenAI, change only TWO things: the base URL and the API key.

## CONNECTION
- Base URL:  ${baseUrl}
- Auth header:  Authorization: Bearer <LLMPANDA_API_KEY>   (x-api-key also works)
- 100% OpenAI-compatible — any OpenAI SDK works unchanged; just repoint base_url/baseURL and use the LLM Panda key.

## RULES
1. SECURITY: never put the key in browser/client/mobile code or a public repo. Read it from a server env var LLMPANDA_API_KEY. For any frontend, call your OWN backend route and have the backend call LLM Panda — the browser never sees the key.
2. Default model "auto" (the router auto-picks the best model and falls back). Use a specific id only if asked; list ids via GET /v1/models.
3. Keep the exact OpenAI request/response shapes. Support streaming when the UI renders text incrementally. Always handle errors.

## ENDPOINTS
- POST /v1/chat/completions   (supports stream:true, tools, vision)
- POST /v1/embeddings
- GET  /v1/models

## CHAT (non-streaming)
Body: { "model": "auto", "messages": [{ "role": "user", "content": "Hello!" }] }
Read choices[0].message.content.

## CHAT (streaming)
Add "stream": true. Server sends SSE \`data: {...}\` lines ending with \`data: [DONE]\`; incremental text is choices[0].delta.content — concatenate the deltas.

## VISION (image input)
Send user content as blocks; the router auto-picks a vision model:
{ "role": "user", "content": [
  { "type": "text", "text": "What is in this image?" },
  { "type": "image_url", "image_url": { "url": "https://.../photo.jpg" } } ] }
A base64 data: URL also works.

## TOOLS
Pass OpenAI-style "tools" + "tool_choice"; tool calls return on choices[0].message.tool_calls; reply with role:"tool" messages.

## EMBEDDINGS
POST /v1/embeddings with { "model": "auto", "input": "text or [array]" }; read data[i].embedding.

## EXAMPLE (Python, OpenAI SDK)
from openai import OpenAI
client = OpenAI(base_url="${baseUrl}", api_key=os.environ["LLMPANDA_API_KEY"])
r = client.chat.completions.create(model="auto", messages=[{"role":"user","content":"Hello!"}])
print(r.choices[0].message.content)

## EXAMPLE (Node / TypeScript, OpenAI SDK)
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "${baseUrl}", apiKey: process.env.LLMPANDA_API_KEY });
const r = await client.chat.completions.create({ model: "auto", messages: [{ role: "user", content: "Hello!" }] });

## EXAMPLE (Next.js App Router — key stays on the server)
// app/api/chat/route.ts
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "${baseUrl}", apiKey: process.env.LLMPANDA_API_KEY });
export async function POST(req: Request) {
  const { messages } = await req.json();
  const r = await client.chat.completions.create({ model: "auto", messages });
  return Response.json(r.choices[0].message);
}

## ERRORS (OpenAI shape: { "error": { "message", "type" } })
401 invalid key · 429 rate/quota (back off + retry) · 400 bad request · 502/503 upstream (already retried — show a friendly message).

When you integrate: put the key in env (LLMPANDA_API_KEY), never leak it to the client, default model "auto", add streaming if the UI streams text, and keep everything OpenAI-compatible.`
}

function IntegrationPromptCard({ baseUrl }: { baseUrl: string }) {
  const [copied, setCopied] = useState(false)
  const prompt = buildIntegrationPrompt(baseUrl)
  async function copy() {
    try { await navigator.clipboard.writeText(prompt) }
    catch {
      const ta = document.createElement('textarea'); ta.value = prompt; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy') } catch { /* ignore */ } ta.remove()
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">AI integration prompt</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Paste this into any AI (Claude, ChatGPT, Cursor, v0…) then say “add this to my site”. It wires LLM Panda in with your key + base URL.
          </p>
        </div>
        <button
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium uppercase tracking-wide text-white/70 transition-colors hover:border-[#5fb13a] hover:text-[#5fb13a]"
        >
          {copied ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="size-3.5 text-[#5fb13a]"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3.5"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-[#0d0d0d] p-4 text-[11px] leading-relaxed text-white/70">{prompt}</pre>
    </section>
  )
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement('textarea')
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="font-display text-xs font-bold uppercase tracking-wide">{title}</span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-white/60 transition-colors hover:border-[#5fb13a] hover:text-[#5fb13a]"
        >
          {copied ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="size-3.5 text-[#5fb13a]"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3.5"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* wrap long lines so each card shows the full snippet — no horizontal scroll */}
      <pre className="flex-1 whitespace-pre-wrap break-words p-4 text-[11px] leading-relaxed">
        <code className="font-mono text-white/80">{code}</code>
      </pre>
    </div>
  )
}

export default function ApiKeyPage() {
  const baseUrl = import.meta.env.DEV
    ? `http://${window.location.hostname}:3001/v1`
    : `${window.location.origin}/v1`

  const curl = `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $LLMPANDA_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`

  const python = `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="YOUR_LLMPANDA_KEY",
)

resp = client.chat.completions.create(
    model="auto",  # or a specific model id
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)`

  const js = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.LLMPANDA_KEY,
});

const resp = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(resp.choices[0].message.content);`

  const vision = `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $LLMPANDA_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{
      "role": "user",
      "content": [
        { "type": "text", "text": "What is in this image?" },
        { "type": "image_url",
          "image_url": { "url": "https://example.com/photo.jpg" } }
      ]
    }]
  }'`

  return (
    <div className="apex">
      <PageHeader
        title="API Key"
        eyebrow="Connect"
        icon={<PlugIcon />}
        description="Your single OpenAI-compatible key for every app. Point any OpenAI SDK at the base URL below."
      />

      <div className="space-y-8">
        <UnifiedKeyCard />
        <ClientKeysCard />
        <BackupCard />
        <IntegrationPromptCard baseUrl={baseUrl} />

        <section>
          <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide">Quick start</h2>
          <div className="grid grid-cols-1 gap-4">
            <CodeBlock title="cURL" code={curl} />
            <CodeBlock title="Python" code={python} />
            <CodeBlock title="JavaScript" code={js} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Use <code className="font-mono">"auto"</code> to let the router pick across your enabled models, or pass a
            specific model id. Add provider keys on the <a href="/keys" className="text-[#5fb13a] underline">Keys</a> page.
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide">Vision</h2>
          <div className="grid grid-cols-1 gap-4">
            <CodeBlock title="Vision — analyze an image" code={vision} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Send an image with an <code className="font-mono">image_url</code> content block — the router auto-picks a
            vision model. <code className="font-mono">data:</code> base64 URLs work too.
          </p>
        </section>

        {/* More docs go here later. */}
      </div>
    </div>
  )
}
