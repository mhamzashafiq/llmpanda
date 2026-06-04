import { useEffect, useRef } from 'react'

/**
 * apex-ui scroll/mount reveal. Element starts with `.reveal` (opacity 0,
 * translateY 40px); when it scrolls into view we add `.visible`. Above-the-fold
 * elements fire immediately, so this doubles as a mount-in animation.
 * See .claude/skills/apex-ui §5.H.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.1) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            el.classList.add('visible')
            io.unobserve(el)
          }
        })
      },
      { threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])
  return ref
}
