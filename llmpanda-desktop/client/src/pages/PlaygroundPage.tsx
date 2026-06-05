import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Markdown } from '@/components/markdown'
import { SectionHeader } from '@/components/apex/section-header'
import { PillButton } from '@/components/apex/pill-button'
import { StatusDot } from '@/components/apex/status-dot'

interface FallbackEntry {
  modelDbId: number
  priority: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  sizeLabel: string
  keyCount: number
  supportsVision?: boolean
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  images?: string[]      // user attachments (vision input), data URLs
  meta?: {
    platform?: string
    model?: string
    latency?: number
    fallbackAttempts?: number
  }
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('auto')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const { data: fallbackEntries = [] } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const availableModels = fallbackEntries.filter(e => e.keyCount > 0 && e.enabled)
  const hasVisionModel = availableModels.some(e => e.supportsVision)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (keyData?.apiKey) h['Authorization'] = `Bearer ${keyData.apiKey}`
    return h
  }
  const v1Base = () => import.meta.env.BASE_URL.replace(/\/$/, '')

  const addFiles = async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'))
    const urls = await Promise.all(imgs.map(fileToDataUrl))
    setAttachments(prev => [...prev, ...urls].slice(0, 4))
  }

  const handleSend = async () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || loading) return

    const userMsg: ChatMessage = { role: 'user', content: text, images: attachments.length ? attachments : undefined }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setAttachments([])
    setLoading(true)
    inputRef.current?.focus()

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Build OpenAI content: array (text + image_url blocks) when images are
      // attached, else a plain string. The proxy auto-routes image requests to
      // a vision model.
      const toContent = (m: ChatMessage) => {
        if (!m.images?.length) return m.content
        const blocks: any[] = []
        if (m.content) blocks.push({ type: 'text', text: m.content })
        for (const url of m.images) blocks.push({ type: 'image_url', image_url: { url } })
        return blocks
      }

      const body: any = {
        stream: true,
        messages: newMessages.map(m => ({ role: m.role, content: toContent(m) })),
      }
      if (selectedModel !== 'auto') body.model = selectedModel

      const start = Date.now()
      const res = await fetch(`${v1Base()}/v1/chat/completions`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: controller.signal,
      })

      const routedVia = res.headers.get('X-Routed-Via')
      const fallbackAttempts = res.headers.get('X-Fallback-Attempts')
      const via = routedVia
        ? { platform: routedVia.split('/')[0], model: routedVia.split('/').slice(1).join('/') }
        : undefined

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        setMessages([...newMessages, { role: 'assistant', content: `Error: ${err.error?.message ?? 'Unknown error'}` }])
        return
      }

      const idx = newMessages.length
      setMessages([...newMessages, { role: 'assistant', content: '' }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const payload = t.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const json = JSON.parse(payload)
            const piece = json.choices?.[0]?.delta?.content ?? ''
            if (piece) {
              acc += piece
              setMessages(prev => {
                const copy = [...prev]
                copy[idx] = { ...copy[idx], content: acc }
                return copy
              })
            }
          } catch { /* ignore keep-alive / non-JSON frames */ }
        }
      }

      const latency = Date.now() - start
      setMessages(prev => {
        const copy = [...prev]
        copy[idx] = {
          ...copy[idx],
          content: acc || '(no content)',
          meta: { platform: via?.platform, model: via?.model, latency, fallbackAttempts: fallbackAttempts ? parseInt(fallbackAttempts) : undefined },
        }
        return copy
      })
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
      }
    } finally {
      abortRef.current = null
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }
  const handleStop = () => abortRef.current?.abort()
  const handleClear = () => { setMessages([]); setAttachments([]); inputRef.current?.focus() }

  const activeModelLabel = selectedModel === 'auto'
    ? 'Auto (fallback chain)'
    : availableModels.find(m => m.modelId === selectedModel)?.displayName ?? selectedModel

  return (
    <div className="apex flex h-[calc(100dvh-8.5rem)] flex-col text-foreground sm:h-[calc(100dvh-7rem)]">
      {/* header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionHeader label="Playground" icon={<ChatIcon />} tone="dark" />
          <h1 className="mt-4 font-display text-3xl font-bold uppercase leading-tight sm:text-4xl">Playground</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Chat or attach an image — the router picks the model (vision when an image is sent).
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v ?? 'auto')}>
            <SelectTrigger className="w-full rounded-full border-border bg-card text-xs uppercase tracking-wide text-foreground sm:w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (fallback chain)</SelectItem>
              {availableModels.map(m => (
                <SelectItem key={m.modelDbId} value={m.modelId}>
                  <span className="flex items-center gap-2">
                    <span>{m.displayName}</span>
                    {m.supportsVision && <span className="text-[10px] uppercase text-[#5fb13a]">vision</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {messages.length > 0 && (
            <PillButton variant="outlineDark" withBadge={false} label="Clear" onClick={handleClear} className="px-5 py-2.5 text-xs" />
          )}
        </div>
      </div>

      {/* chat panel */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center">
              <div className="max-w-sm space-y-3">
                <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted text-[#5fb13a]">
                  <ChatIcon />
                </span>
                <p className="font-display text-lg font-bold uppercase">Send a message to get started</p>
                <p className="text-sm text-muted-foreground">
                  Using <span className="text-[#5fb13a]">{activeModelLabel}</span>. Attach an image with the clip button to analyze it.
                </p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === 'user' ? 'bg-[#5fb13a] text-[#191919]' : 'bg-muted text-foreground'}`}>
                    {msg.images?.length ? (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {msg.images.map((src, k) => (
                          <a key={k} href={src} target="_blank" rel="noreferrer">
                            <img src={src} alt="" className="max-h-64 rounded-xl border border-black/10 object-cover" />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {msg.content && (msg.role === 'assistant'
                      ? <Markdown>{msg.content}</Markdown>
                      : <div className="whitespace-pre-wrap">{msg.content}</div>)}
                    {msg.meta && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                        <StatusDot status="healthy" className="size-1.5" />
                        {msg.meta.platform && <span className="uppercase tracking-wide">{msg.meta.platform}</span>}
                        {msg.meta.model && <span className="font-mono">· {msg.meta.model}</span>}
                        {msg.meta.latency != null && <span>· {msg.meta.latency} ms</span>}
                        {msg.meta.fallbackAttempts != null && msg.meta.fallbackAttempts > 0 && (
                          <span>· {msg.meta.fallbackAttempts} fallback{msg.meta.fallbackAttempts > 1 ? 's' : ''}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-muted px-4 py-3">
                    <div className="flex gap-1">
                      <span className="size-1.5 animate-bounce rounded-full bg-[#5fb13a]" style={{ animationDelay: '0ms' }} />
                      <span className="size-1.5 animate-bounce rounded-full bg-[#5fb13a]" style={{ animationDelay: '150ms' }} />
                      <span className="size-1.5 animate-bounce rounded-full bg-[#5fb13a]" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* composer */}
        <div
          className="border-t border-border bg-background/40 p-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}
        >
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((src, k) => (
                <div key={k} className="relative">
                  <img src={src} alt="" className="size-14 rounded-lg border border-border object-cover" />
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== k))}
                    className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-background text-xs text-foreground ring-1 ring-border"
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-3">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }} />
            <button
              onClick={() => fileRef.current?.click()}
              title={hasVisionModel ? 'Attach image' : 'Attach image (enable a vision model first)'}
              className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:border-[#5fb13a] hover:text-[#5fb13a]"
            ><PaperclipIcon /></button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (⏎ to send, ⇧⏎ for newline)"
              rows={1}
              className="max-h-[160px] min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[#5fb13a] focus:ring-2 focus:ring-[#5fb13a]/30"
              style={{ height: 'auto', overflow: 'hidden' }}
              onInput={e => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }}
            />
            {loading ? (
              <PillButton variant="outlineDark" withBadge={false} label="Stop" onClick={handleStop} className="px-6 py-3" />
            ) : (
              <PillButton onClick={handleSend} disabled={!input.trim() && attachments.length === 0} label="Send" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
