import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'

interface Gauge { used: number; limit: number | null }
interface UsageRow { platform: string; modelId: string; displayName: string; keyId: number; keyLabel: string; rpm: Gauge; rpd: Gauge; tpm: Gauge }
interface Connection { id: number; provider: string; label: string | null; email: string | null; expiresAt: string | null; enabled: boolean }

function pct(g: Gauge): number {
  if (!g.limit || g.limit <= 0) return 0
  return Math.min(100, Math.round((g.used / g.limit) * 100))
}
function barColor(p: number): string {
  if (p >= 95) return '#ff4d4f'
  if (p >= 70) return '#f5a623'
  return '#5fb13a'
}

function Bar({ label, g }: { label: string; g: Gauge }) {
  if (g.limit == null && g.used === 0) return null
  const p = pct(g)
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-8 shrink-0 uppercase tracking-wide text-white/40">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${g.limit ? p : 0}%`, background: barColor(p) }} />
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums text-white/60">{g.used}{g.limit != null ? ` / ${g.limit}` : ' (∞)'}</span>
    </div>
  )
}

export default function QuotaPage() {
  const { data: usage = [], isError } = useQuery<UsageRow[]>({ queryKey: ['quota-usage'], queryFn: () => apiFetch('/api/fallback/usage'), refetchInterval: 15_000 })
  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: () => apiFetch('/api/connections') })

  // Sort by highest utilization (rpd then tpm) so near-limit rows surface first.
  const rows = [...usage].sort((a, b) => Math.max(pct(b.rpd), pct(b.tpm)) - Math.max(pct(a.rpd), pct(a.tpm)))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Quota"
        title="Quota tracker"
        icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12 20v-6M6 20V10M18 20V4" /></svg>}
        description="Live rate-limit usage per model + key (rolling windows), and connected-account token expiry. Use every bit before the window rolls over."
      />

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide">Provider usage</h2>
        {isError ? (
          <p className="text-xs text-[#ff4d4f]">Can't reach the server.</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No keyed usage yet. Add provider keys on the Keys page — usage appears here as requests flow.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {rows.map(r => (
              <li key={`${r.platform}:${r.modelId}:${r.keyId}`} className="py-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{r.displayName}</span>
                  <span className="shrink-0 text-[11px] text-white/40">{r.platform} · {r.keyLabel}</span>
                </div>
                <div className="space-y-1">
                  <Bar label="RPD" g={r.rpd} />
                  <Bar label="RPM" g={r.rpm} />
                  <Bar label="TPM" g={r.tpm} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {connections.length > 0 && (
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide">Connected accounts</h2>
          <ul className="divide-y divide-white/5">
            {connections.map(c => {
              const exp = c.expiresAt ? new Date(c.expiresAt).getTime() : 0
              const mins = exp ? Math.round((exp - Date.now()) / 60000) : 0
              const expired = exp > 0 && exp < Date.now()
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                  <span className="min-w-0">
                    <span className="font-medium">{c.label || c.provider}</span>
                    <span className="ml-2 text-white/40">{c.email || c.provider}</span>
                  </span>
                  <span className={['shrink-0', !c.enabled ? 'text-white/30' : expired ? 'text-[#ff4d4f]' : mins < 60 ? 'text-[#f5a623]' : 'text-[#5fb13a]'].join(' ')}>
                    {!c.enabled ? 'disabled' : !exp ? 'connected' : expired ? 'token expired (auto-refresh)' : `token ~${mins < 60 ? mins + 'm' : Math.round(mins / 60) + 'h'} left`}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
