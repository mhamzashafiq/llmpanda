import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PillVariant = 'accent' | 'outline' | 'outlineDark'

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  variant?: PillVariant
  fullWidth?: boolean
  /** Show the signature sliding double-arrow badge. */
  withBadge?: boolean
  /** Optional leading glyph (e.g. a GitHub mark). */
  leadingIcon?: ReactNode
}

function DoubleChevron() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
    >
      <path d="M5 5l7 7-7 7M12 5l7 7-7 7" />
    </svg>
  )
}

/**
 * apex-ui signature Pill CTA — sliding text stack + double-arrow badge that
 * swaps on hover. See .claude/skills/apex-ui §5.A. The sliding animation is
 * driven by `.pill-cta` rules in index.css.
 */
export function PillButton({
  label,
  variant = 'accent',
  fullWidth = false,
  withBadge = true,
  leadingIcon,
  className,
  type = 'button',
  ...props
}: PillButtonProps) {
  const variants: Record<PillVariant, string> = {
    accent: 'bg-[#1e6602] text-white hover:bg-[#27800a]',
    outline: 'bg-transparent border border-[#191919]/15 text-[#191919] hover:border-[#191919]',
    outlineDark: 'bg-transparent border border-border text-foreground hover:border-[#5fb13a] hover:text-[#5fb13a]',
  }

  return (
    <button
      type={type}
      className={cn(
        'pill-cta group inline-flex cursor-pointer items-center rounded-full font-bold transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-60',
        withBadge ? 'justify-between gap-4 p-1.5 pl-7' : 'justify-center gap-3 px-7 py-3',
        fullWidth && 'flex w-full',
        variants[variant],
        className,
      )}
      {...props}
    >
      {leadingIcon && <span className="shrink-0">{leadingIcon}</span>}
      <span className="text-slide-wrap">
        <span className="text-slide-inner block">
          <span className="h-6 flex items-center font-display uppercase text-sm tracking-wide">{label}</span>
          <span className="h-6 flex items-center font-display uppercase text-sm tracking-wide">{label}</span>
        </span>
      </span>
      {withBadge && (
        <span className="relative w-10 h-10 rounded-full bg-white overflow-hidden flex items-center justify-center shrink-0">
          <span className="arrow-slide absolute text-[#1e6602]">
            <DoubleChevron />
          </span>
          <span className="arrow-enter absolute text-[#1e6602]">
            <DoubleChevron />
          </span>
        </span>
      )}
    </button>
  )
}
