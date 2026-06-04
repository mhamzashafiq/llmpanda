import { cn } from '@/lib/utils'

/**
 * Functional STATUS colors — the ONLY sanctioned break from apex-ui's
 * single-chromatic-color rule (see CLAUDE.md / .claude/rules/client-design.md).
 */
export type Status = 'healthy' | 'rate_limited' | 'invalid' | 'disabled' | 'accent'

export const STATUS_COLOR: Record<Status, string> = {
  healthy: '#5fb13a',
  accent: '#5fb13a',
  rate_limited: '#f5a623',
  invalid: '#ff4d4f',
  disabled: '#555555',
}

export function StatusDot({
  status = 'accent',
  pulse = false,
  className,
}: {
  status?: Status
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('inline-block size-2 rounded-full', pulse && 'animate-pulse', className)}
      style={{ backgroundColor: STATUS_COLOR[status] }}
    />
  )
}
