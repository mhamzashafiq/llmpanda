import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'

// ── shared helpers ──────────────────────────────────────────────────────────
const CODING_KEY_NAME = 'Coding Agents'
const LS_KEY = 'llmpanda.codingAgentsKey' // { id, key } — caches the show-once plaintext for re-display

// Root (no /v1) for Anthropic clients; `${root}/v1` for OpenAI clients.
function deriveBaseRoot(): string {
  return import.meta.env.DEV ? `http://${window.location.hostname}:3001` : window.location.origin
}

interface ClientKey {
  id: number
  name: string
  keyPrefix: string
  allowedModelIds: number[] | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface ModelRow {
  id: number
  platform: string
  modelId: string
  displayName: string
  supportsVision: boolean
  intelligenceRank: number
  hasProvider: boolean
  fallbackEnabled: boolean
}

function readCachedKey(id: number | undefined): string | null {
  if (!id) return null
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    return v && v.id === id ? v.key : null
  } catch { return null }
}
function writeCachedKey(id: number, key: string) {
  localStorage.setItem(LS_KEY, JSON.stringify({ id, key }))
}

// ── copy-able code block (matches ApiKeyPage) ───────────────────────────────
function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(code) } catch {
      const ta = document.createElement('textarea')
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      ta.remove()
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500)
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
      <pre className="flex-1 whitespace-pre-wrap break-words p-4 text-[11px] leading-relaxed"><code className="font-mono text-white/80">{code}</code></pre>
    </div>
  )
}

// ── agent definitions ───────────────────────────────────────────────────────
type AgentKind = 'anthropic' | 'responses' | 'openai'
interface AgentDef { key: string; name: string; kind: AgentKind; badges: string[]; docs: string }
const AGENTS: AgentDef[] = [
  { key: 'claude', name: 'Claude Code', kind: 'anthropic', badges: ['Anthropic API', '/v1/messages'], docs: 'https://docs.claude.com/en/docs/claude-code/overview' },
  { key: 'codex', name: 'Codex CLI', kind: 'responses', badges: ['Responses API'], docs: 'https://github.com/openai/codex' },
  { key: 'cline', name: 'Cline', kind: 'openai', badges: ['VS Code'], docs: 'https://docs.cline.bot' },
  { key: 'opencode', name: 'OpenCode', kind: 'openai', badges: ['CLI'], docs: 'https://opencode.ai/docs' },
  { key: 'goose', name: 'Goose', kind: 'openai', badges: ['CLI'], docs: 'https://block.github.io/goose' },
  { key: 'continue', name: 'Continue', kind: 'openai', badges: ['IDE'], docs: 'https://docs.continue.dev' },
  { key: 'aider', name: 'Aider', kind: 'openai', badges: ['CLI'], docs: 'https://aider.chat/docs' },
  { key: 'zed', name: 'Zed', kind: 'openai', badges: ['Editor'], docs: 'https://zed.dev/docs/assistant/configuration' },
  { key: 'roo', name: 'Roo Code', kind: 'openai', badges: ['VS Code'], docs: 'https://docs.roocode.com' },
]

function snippetFor(a: AgentDef, root: string, key: string): string {
  const v1 = `${root}/v1`
  if (a.kind === 'anthropic') {
    return [
      `export ANTHROPIC_BASE_URL=${root}`,
      `export ANTHROPIC_AUTH_TOKEN=${key}`,
      `export ANTHROPIC_API_KEY=""`,
      `claude --model auto`,
      ``,
      `# or, one command:`,
      `npx llmpanda claude --model auto`,
    ].join('\n')
  }
  if (a.kind === 'responses') {
    return [
      `# ~/.codex/config.toml`,
      `model_provider = "llmpanda"`,
      `[model_providers.llmpanda]`,
      `name = "LLM Panda"`,
      `base_url = "${v1}"`,
      `wire_api = "responses"`,
      `env_key = "LLMPANDA_KEY"`,
      ``,
      `export LLMPANDA_KEY=${key}`,
      `codex --model auto`,
      `# or: npx llmpanda codex`,
    ].join('\n')
  }
  // generic OpenAI-compatible
  return [
    `export OPENAI_BASE_URL=${v1}`,
    `export OPENAI_API_BASE=${v1}   # aider`,
    `export OPENAI_API_KEY=${key}`,
    `# model: auto`,
    ``,
    `# or: npx llmpanda ${a.key}`,
    `# editors (Cline/Roo/Zed): paste Base URL ${v1} + the key`,
  ].join('\n')
}

// Best coding-tuned models, picked by name pattern from whatever's available
// (coder/instruct/reasoning families known to be strong at code). Falls back to
// the smartest models overall if nothing matches. Capped so the set stays tight.
const CODING_RX = /(coder|qwen ?3|qwen3|kimi|k2|glm-?[457]|deepseek|minimax|codestral|devstral|mistral[- ]?large|gpt-?oss|cogito|grok.?code|llama[- ]?3\.3|magistral|gemini-?[23][.\d]*[- ]?pro|nemotron|command-?a)/i
function bestCodingIds(models: ModelRow[], cap = 12): number[] {
  const usable = models.filter(m => m.hasProvider)
  const matched = usable.filter(m => CODING_RX.test(m.modelId) || CODING_RX.test(m.displayName))
  const pool = matched.length ? matched : usable
  return [...pool].sort((a, b) => a.intelligenceRank - b.intelligenceRank).slice(0, cap).map(m => m.id)
}

// ── Coding Agents key + model picker ────────────────────────────────────────
function KeyAndModels({ codingKey, plaintext, onPlaintext }: {
  codingKey: ClientKey | undefined
  plaintext: string | null
  onPlaintext: (id: number, key: string) => void
}) {
  const queryClient = useQueryClient()
  const { data: models = [] } = useQuery<ModelRow[]>({ queryKey: ['models'], queryFn: () => apiFetch('/api/models') })

  const create = useMutation({
    mutationFn: () => apiFetch<{ id: number; key: string }>('/api/settings/clients', { method: 'POST', body: JSON.stringify({ name: CODING_KEY_NAME }) }),
    onSuccess: (res) => { onPlaintext(res.id, res.key); queryClient.invalidateQueries({ queryKey: ['client-keys'] }) },
  })
  const regenerate = useMutation({
    mutationFn: async () => {
      if (codingKey) await apiFetch(`/api/settings/clients/${codingKey.id}`, { method: 'DELETE' })
      return apiFetch<{ id: number; key: string }>('/api/settings/clients', { method: 'POST', body: JSON.stringify({ name: CODING_KEY_NAME }) })
    },
    onSuccess: (res) => { onPlaintext(res.id, res.key); queryClient.invalidateQueries({ queryKey: ['client-keys'] }) },
  })
  const saveModels = useMutation({
    mutationFn: (ids: number[]) => apiFetch(`/api/settings/clients/${codingKey!.id}`, { method: 'PATCH', body: JSON.stringify({ allowedModelIds: ids }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-keys'] }),
  })

  // selected = allowedModelIds; empty = all allowed.
  const [selected, setSelected] = useState<Set<number>>(new Set(codingKey?.allowedModelIds ?? []))
  useEffect(() => { setSelected(new Set(codingKey?.allowedModelIds ?? [])) }, [codingKey?.id, codingKey?.allowedModelIds])

  const dirty = useMemo(() => {
    const cur = new Set(codingKey?.allowedModelIds ?? [])
    if (cur.size !== selected.size) return true
    for (const id of selected) if (!cur.has(id)) return true
    return false
  }, [selected, codingKey?.allowedModelIds])

  function toggle(id: number) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const keyDisplay = plaintext ?? (codingKey ? `${codingKey.keyPrefix}••••••••  (regenerate to reveal)` : '—')

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">Coding Agents key</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">One key for every agent below. Paste it where each agent asks for an API key.</p>
        </div>
        {codingKey ? (
          <Button variant="ghost" size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>Regenerate</Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => create.mutate()} disabled={create.isPending}>Generate key</Button>
        )}
      </div>

      {codingKey ? (
        <>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all truncate rounded-xl border border-white/10 bg-[#272727] px-3 py-2 font-mono text-xs">{keyDisplay}</code>
            {plaintext && (
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(plaintext)}>Copy</Button>
            )}
          </div>
          {plaintext && (
            <p className="mt-1.5 text-[11px] text-[#5fb13a]">Copy this now — for security the full key is shown once (cached in this browser only).</p>
          )}

          {/* model picker */}
          <div className="mt-5 border-t pt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-xs font-bold uppercase tracking-wide">Models the agents may use</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {selected.size === 0 ? 'All models allowed. Select some to restrict to the best ones.' : `${selected.size} model${selected.size > 1 ? 's' : ''} selected — only these route.`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={!models.length} onClick={() => setSelected(new Set(bestCodingIds(models)))}>✨ Best for coding</Button>
                {selected.size > 0 && <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Allow all</Button>}
                <Button variant="outline" size="sm" disabled={!dirty || saveModels.isPending} onClick={() => saveModels.mutate(Array.from(selected))}>
                  {saveModels.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                </Button>
              </div>
            </div>
            <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {models.filter(m => m.hasProvider).map(m => {
                const on = selected.has(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    className={[
                      'flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors',
                      on ? 'border-[#5fb13a] bg-[#5fb13a]/10 text-white' : 'border-white/10 bg-[#272727] text-white/70 hover:border-white/25',
                    ].join(' ')}
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{m.displayName}</span>
                      <span className="ml-1.5 text-white/40">{m.platform}</span>
                    </span>
                    <span className={[
                      'flex size-4 shrink-0 items-center justify-center rounded border',
                      on ? 'border-[#5fb13a] bg-[#5fb13a] text-[#191919]' : 'border-white/25',
                    ].join(' ')}>
                      {on && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="size-3"><path d="M20 6 9 17l-5-5" /></svg>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-white/10 bg-[#272727] px-3 py-3 text-xs text-muted-foreground">
          No Coding Agents key yet. Click <span className="text-white">Generate key</span> to create one, then pick which models it may use.
        </div>
      )}
    </section>
  )
}

// ── agent card ──────────────────────────────────────────────────────────────
function AgentCard({ agent, root, keyValue }: { agent: AgentDef; root: string; keyValue: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold uppercase tracking-wide">{agent.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {agent.badges.map(b => (
              <span key={b} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">{b}</span>
            ))}
          </div>
        </div>
        <a href={agent.docs} target="_blank" rel="noreferrer" className="text-[11px] uppercase tracking-wide text-white/50 transition-colors hover:text-[#5fb13a]">Docs ↗</a>
      </div>
      <CodeBlock title={`${agent.name} setup`} code={snippetFor(agent, root, keyValue)} />
    </div>
  )
}

export default function AgentsPage() {
  const { data: clients = [] } = useQuery<ClientKey[]>({ queryKey: ['client-keys'], queryFn: () => apiFetch('/api/settings/clients') })
  const codingKey = useMemo(() => clients.find(c => c.name === CODING_KEY_NAME && !c.revokedAt), [clients])

  // Show-once plaintext: prefer one captured this session (create/regenerate),
  // else the browser-cached copy for this key id.
  const [freshKey, setFreshKey] = useState<{ id: number; key: string } | null>(null)
  const plaintext = freshKey && freshKey.id === codingKey?.id ? freshKey.key : readCachedKey(codingKey?.id)
  function onPlaintext(id: number, key: string) { writeCachedKey(id, key); setFreshKey({ id, key }) }

  const root = deriveBaseRoot()
  const keyValue = plaintext ?? '<YOUR_CODING_AGENTS_KEY>'

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agents"
        title="Coding agents"
        icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M8 9l3 3-3 3M13 15h3M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /></svg>}
        description="Use LLM Panda's free models inside Claude Code, Codex, Cline and more. Assign which models they may use, then paste the setup into each agent."
      />

      <KeyAndModels codingKey={codingKey} plaintext={plaintext} onPlaintext={onPlaintext} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {AGENTS.map(a => <AgentCard key={a.key} agent={a} root={root} keyValue={keyValue} />)}
      </div>
    </div>
  )
}
