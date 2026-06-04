---
description: "apex-ui design rules for the dashboard"
globs: "client/**"
---

# Client design rules (`client/**`)

These rules apply to all dashboard code under `client/`. They enforce the apex-ui design system —
see `.claude/skills/apex-ui` (and its `reference.html`) for the full spec.

- **Tokens & typography:** use apex-ui tokens. Headings = **uppercase Unbounded**; body = Roboto.
  No lowercase display headings, no Unbounded for body copy.
- **Pill buttons:** all primary actions are pill-shaped (`rounded-full`) — never `rounded-lg` or
  square. Use the shared `PillButton` primitive.
- **Dark cards:** dark surfaces use `#272727` (hover `#333333`), never pure black.
- **Status-color exception:** the single-chromatic-color rule is broken ONLY for functional STATUS
  colors — healthy=accent `#d6fb03`, rate_limited=amber `#f5a623`, invalid=red `#ff4d4f`,
  error/disabled=muted. No other second chromatic color is allowed.
- **No gradients** anywhere. All sections/cards are flat color.
- **No CDN Tailwind** and no inline/standalone HTML — React + Tailwind v4 + shadcn components only.
