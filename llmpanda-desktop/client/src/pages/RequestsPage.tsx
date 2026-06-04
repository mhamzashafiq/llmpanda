import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { StatusDot } from '@/components/apex/status-dot'

type TimeRange = '24h' | '7d' | '30d'
type StatusFilter = 'all' | 'success' | 'error'

interface RequestRow {
  id: number
  platform: string
  modelId: string
  displayName: string
  status: 'success' | 'error'
  inputTokens: number
  outputTokens: number
  latencyMs: number
  ttfbMs: number | null
  error: string | null
  prompt: string | null
  response: string | null
  createdAt: string
}

function LogIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  )
}

export default function RequestsPage() {
  const [range, setRange] = useState<TimeRange>('24h')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggle = (id: number) => setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const { data: rows = [], isLoading } = useQuery<RequestRow[]>({
    queryKey: ['analytics', 'requests', range, status],
    queryFn: () =>
      apiFetch(`/api/analytics/requests?range=${range}&limit=200${status !== 'all' ? `&status=${status}` : ''}`),
    refetchInterval: 10_000,
  })

  return (
    <div className="apex">
      <PageHeader
        title="Request Log"
        eyebrow="Logs"
        icon={<LogIcon />}
        description="Every request routed through the proxy — provider, model, latency, tokens, and errors."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-full border p-1">
              {(['all', 'success', 'error'] as StatusFilter[]).map(s => (
                <Button key={s} variant={status === s ? 'default' : 'ghost'} size="xs" className="rounded-full uppercase tracking-wide" onClick={() => setStatus(s)}>
                  {s}
                </Button>
              ))}
            </div>
            <div className="flex gap-1 rounded-full border p-1">
              {(['24h', '7d', '30d'] as TimeRange[]).map(r => (
                <Button key={r} variant={range === r ? 'default' : 'ghost'} size="xs" className="rounded-full uppercase tracking-wide" onClick={() => setRange(r)}>
                  {r}
                </Button>
              ))}
            </div>
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">No requests in this window. Send one from the Playground.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 text-right font-medium">Latency</th>
                <th className="px-4 py-3 text-right font-medium">TTFB</th>
                <th className="px-4 py-3 text-right font-medium">In</th>
                <th className="px-4 py-3 text-right font-medium">Out</th>
                <th className="px-4 py-3 font-medium">Prompt</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isOpen = open.has(r.id)
                return (
                <Fragment key={r.id}>
                <tr onClick={() => toggle(r.id)} className="cursor-pointer border-b last:border-0 transition-colors hover:bg-white/5">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                    {new Date(r.createdAt + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <StatusDot status={r.status === 'success' ? 'healthy' : 'invalid'} className="size-1.5" />
                      <span className={r.status === 'success' ? 'text-[#5fb13a]' : 'text-[#ff4d4f]'}>{r.status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{r.displayName}</span>
                    <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">{r.platform}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.latencyMs} ms</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.ttfbMs != null ? `${r.ttfbMs} ms` : '–'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.inputTokens}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.outputTokens}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-xs text-white/60" title={r.prompt ?? ''}>{r.prompt ?? '—'}</td>
                  <td className="px-3 py-3 text-muted-foreground">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`size-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b last:border-0 bg-[#191919]/60">
                    <td colSpan={9} className="px-4 py-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Prompt</p>
                          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-[#0d0d0d] p-3 text-xs text-white/80">{r.prompt ?? '—'}</pre>
                        </div>
                        <div>
                          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Response</p>
                          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-[#0d0d0d] p-3 text-xs text-white/80">{r.response ?? (r.error ? '' : '—')}</pre>
                        </div>
                      </div>
                      {r.error && (
                        <div className="mt-3">
                          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Error</p>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#ff4d4f]/30 bg-[#ff4d4f]/10 p-3 text-xs text-[#ff4d4f]">{r.error}</pre>
                        </div>
                      )}
                      <p className="mt-3 text-[11px] text-muted-foreground">
                        {new Date(r.createdAt + 'Z').toLocaleString()} · {r.platform}/{r.modelId} · key #{(r as RequestRow & { keyId?: number }).keyId ?? '—'} · {r.inputTokens}→{r.outputTokens} tok · {r.latencyMs}ms
                      </p>
                    </td>
                  </tr>
                )}
                </Fragment>
              )})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
