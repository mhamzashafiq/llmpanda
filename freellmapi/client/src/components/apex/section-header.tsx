import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * apex-ui Section Header breadcrumb — icon badge + uppercase label.
 * See .claude/skills/apex-ui §5.B. `tone` follows the section background:
 * on light sections the badge is dark; on dark sections it is accent.
 */
export function SectionHeader({
  label,
  icon,
  tone = 'light',
  className,
}: {
  label: string
  icon?: ReactNode
  tone?: 'light' | 'dark'
  className?: string
}) {
  const onLight = tone === 'light'
  return (
    <div className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center',
          onLight ? 'bg-[#191919] text-[#5fb13a]' : 'bg-[#5fb13a] text-[#191919]',
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          'text-sm uppercase tracking-wide font-medium',
          onLight ? 'text-[#191919]' : 'text-[#5fb13a]',
        )}
      >
        {label}
      </span>
    </div>
  )
}
