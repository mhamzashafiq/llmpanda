import { type ElementType, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useReveal } from './use-reveal'

interface RevealProps {
  children: ReactNode
  /** Stagger in ms — maps to CSS transition-delay. */
  delay?: number
  className?: string
  as?: ElementType
}

/**
 * apex-ui reveal wrapper. Renders `.reveal` + a transition-delay for staggered
 * entrances, and adds `.visible` once in view (via useReveal).
 */
export function Reveal({ children, delay = 0, className, as: Tag = 'div' }: RevealProps) {
  const ref = useReveal<HTMLElement>()
  return (
    <Tag ref={ref} className={cn('reveal', className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  )
}
