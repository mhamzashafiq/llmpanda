import { Fragment } from 'react'
import { cn } from '@/lib/utils'

/**
 * apex-ui Marquee — horizontal auto-scroll strip with duplicated items for a
 * seamless loop (translateX 0 → -50% over 40s). Pauses on hover.
 * See .claude/skills/apex-ui §5.I. Animation lives in index.css (.marquee-track).
 */
export function Marquee({ items, className }: { items: string[]; className?: string }) {
  // Duplicate the set so the -50% translate lands exactly on a repeat.
  const loop = [...items, ...items]
  return (
    <div className={cn('w-full overflow-hidden', className)}>
      <div className="marquee-track flex w-max items-center gap-10 whitespace-nowrap">
        {loop.map((item, i) => (
          <Fragment key={i}>
            <span className="font-display text-2xl uppercase text-white/10">{item}</span>
            <span className="text-lg text-[#5fb13a]">★</span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}
