---
name: apex-ui
description: "Design system for bold, high-performance marketing sites — gyms, agencies, SaaS, sports brands. Use this skill whenever the user wants to build a landing page, marketing site, or product page with a premium, energetic aesthetic: pill-shaped CTAs with sliding arrow animation, section alternation between white and near-black backgrounds, acid-green or neon accent color, uppercase Unbounded headings, floating pill navbar, card grids with hover-lift effects, and masonry-style testimonial/team layouts. Trigger on any mention of a gym site, agency landing page, bold marketing page, performance brand, or when the user asks to build something that looks premium or high-energy."
---

# Apex UI — Bold Marketing Design System

## 1. Meta Directive

You build **premium, high-energy marketing sites**. The aesthetic is stark black/white contrast, one electric accent, brutally uppercase display type, and micro-interactions that reward attention. Think premium gym brands, sports tech, creative agencies — anything that needs to feel powerful without being garish.

**Core identity:** monochromatic canvas + neon punctuation. Every pixel should feel intentional, expensive, and kinetic.

> **Working example:** `reference.html` (in this skill folder) is a full, runnable apex-ui implementation — use it as the canonical reference. **FreeLLMAPI exception:** the dashboard may use functional STATUS colors (healthy=accent `#d6fb03`, rate_limited=amber `#f5a623`, invalid=red `#ff4d4f`, error/disabled=muted) as the ONLY permitted break from the single-chromatic-color rule.

---

## 2. THE "ABSOLUTE ZERO" DIRECTIVE

If your output includes ANY of the following, the design fails:

- **Banned Colors:** More than one chromatic color. Gradients of any kind. Gray text on dark backgrounds (use white at varying opacities).
- **Banned Typography:** Lowercase headings. `font-primary` (Unbounded) used for body copy. More than two fonts. Serif fonts for display.
- **Banned Shapes:** `rounded-lg` or sharp corners on buttons — buttons are always pills (`rounded-full`).
- **Banned Layouts:** Two dark sections adjacent without a light section between them. Edge-to-edge sticky navbars glued to the top.
- **Banned Motion:** Default `linear` or `ease-in-out` transitions. Animating `width`, `height`, `top`, or `left`. Missing hover states on interactive elements.

---

## 3. TOKENS

### Colors
```css
--color-accent:     #d6fb03;  /* electric acid-green — THE ONLY chromatic color */
--color-dark:       #191919;  /* near-black backgrounds + primary text */
--color-light:      #ffffff;  /* page background */
--color-surface:    #f4f4f4;  /* subtle off-white surface variant */
--color-card-dark:  #272727;  /* dark card surface (never pure black) */
--color-card-hover: #333333;  /* dark card hover state */
--color-border:     rgba(25, 25, 25, 0.14);
--color-text-muted: #555555;
```

> Swapping `--color-accent` to purple, orange, or electric blue instantly re-skins the entire system. Everything else stays achromatic.

### Typography
- **Display / headings:** `Unbounded` — always **UPPERCASE**, tight tracking, weights 600–700. Hero: up to `80px`. Section titles: `text-4xl` to `text-5xl`. Never use Unbounded for body text.
- **Body / UI:** `Roboto` — weights 400–500, sentence case for body, uppercase for labels. Body: `text-base` or `text-lg` with `leading-relaxed`.
- **Scale hierarchy:** Micro labels (`text-xs uppercase tracking-widest`) → Breadcrumb labels (`text-sm uppercase tracking-wide`) → Section titles (`text-4xl/5xl`) → Hero (`text-[80px]`).

### Spacing & Shapes
- Section padding: `py-[120px]` (alias `py-section-y`).
- Container: `max-w-7xl mx-auto px-6`.
- Buttons: `rounded-full` (pill). Cards: `rounded-2xl`. Inputs: `rounded-xl`. Avatars: `rounded-full`.
- Shadows: `shadow-card` (`0 10px 30px rgba(0,0,0,0.05)`) max. Never heavy drop shadows.

---

## 4. SECTION ALTERNATION RHYTHM

Sections MUST alternate backgrounds in this strict rhythm to create visual breathing room:

```
Hero          → dark (full-bleed image + black overlay)
About         → light (#ffffff)
Services      → dark (#191919)
Why Us        → light
Before/After  → surface (#f4f4f4)
Pricing       → dark
Testimonials  → light
Team          → dark
Contact/CTA   → light
Blog/Marquee  → light
Footer        → dark
```

**Never** place two dark sections adjacent. The alternation is the core pacing mechanism.

---

## 5. COMPONENT MASTERY

### A. The Pill CTA (Signature Interaction)

Every primary action uses a pill-shaped button with a **sliding double-arrow** animation on hover.

**Structure:**
1. Outer pill: `inline-flex items-center justify-between p-1 pl-6 rounded-full border`.
2. **Sliding text:** Two identical labels stacked vertically inside a `h-6 overflow-hidden` container. On `group-hover`, translate the stack up by `-translate-y-1/2`.
3. **Arrow badge:** A `w-10 h-10 rounded-full` circle containing TWO identical double-chevron SVGs. One sits at rest; the other starts at `-translate-x-[200%]`. On hover, the first exits right (`translate-x-[200%]`) while the second enters from the left.

**Color logic:**
- On light: primary fill = accent, badge = dark, hover = white.
- On dark: primary fill = accent, badge = dark, hover = white. Ghost variant = transparent fill, white badge, hover = accent.
- The sliding text and arrow animation are **not optional** — they are the signature.

### B. Section Header (Breadcrumb)

Every major section opens with the same hierarchy signal:
1. An `inline-flex` row with a `w-8 h-8 rounded-full` icon badge + a `text-sm uppercase tracking-wide` label.
2. Below it: the section `h2` in `font-primary uppercase` at `text-4xl md:text-5xl`.

On light sections: badge bg = dark, label = dark. On dark sections: badge bg = accent, label = accent.

### C. Cards on Dark Backgrounds

Dark cards use `bg-[#272727]`, not pure black. On hover: `bg-[#333333]`.

**Standard card:** Icon in a frosted circular badge (`bg-white/5 rounded-full`) that scales up on hover (`group-hover:scale-110`). Title in uppercase Unbounded. Description in Roboto at `text-white/60`. "View Details" link with inline chevron.

**Accent card:** One card per grid gets `bg-accent` with dark text. Add a large decorative SVG at low opacity (`text-dark/10`) positioned absolute in the background. Hover: slightly darker accent (`#c4eb02`).

**Image card:** Embedded image uses `mix-blend-luminosity opacity-80` (grayscale). On hover: `mix-blend-normal opacity-100` (color revealed). This grayscale-to-color reveal is a key premium micro-interaction.

### D. Testimonial Masonry

Three columns with **intentional vertical offsets** to break monotony:
- Col 1: image top, card bottom.
- Col 2: card top (offset `pt-12` on mobile), image bottom. The card here uses `bg-accent`.
- Col 3: image top (tall), card bottom.

Cards: `rounded-2xl p-10`. Quote in `font-primary uppercase`. Author at bottom with avatar + name/role. Hover: `hover:-translate-y-2`.

### E. Team Cards

Full-height image cards (`h-[520px]`) with `overflow-hidden`.
- Image zoom on hover: `group-hover:scale-105` over `duration-700`.
- Name plate: `bg-accent rounded-r-full` anchored `bottom-8 left-0`. Slides up on hover from `translate-y-4 opacity-90` to `translate-y-0 opacity-100`.

### F. Pricing Cards

Wide horizontal cards with two zones: content left, portrait image right.
- Standard variant: `bg-[#272727]`, image with `mix-blend-luminosity`.
- Featured variant: `bg-accent`, image without blend mode.
- Tab switcher: `rounded-full` pill container with active tab getting `bg-accent text-dark`.

### G. Floating Navbar

Detached from the top edge. Outer container: `bg-black/40 backdrop-blur-md rounded-full border border-white/10`. Max-width centered, not full-bleed.
- Left: pill containing logo + hamburger.
- Right: phone link (hidden mobile) + pill CTA.
- Mobile overlay: full-screen `bg-dark`, slides from right with `duration-500`. Links at `text-3xl uppercase`.

### H. Scroll Reveals

Every section block animates in. Default pattern: `opacity: 0, translateY(40px)` → `opacity: 1, translateY(0)` over `800ms` with `cubic-bezier(0.16, 1, 0.3, 1)`. Trigger via `IntersectionObserver` at `threshold: 0.1`.

### I. Marquee

Horizontal auto-scroll strip with duplicated items for seamless loop. CSS animation: `translateX(0)` → `translateX(-50%)` over `40s linear infinite`. Pause on hover.

### J. Footer

Dark background. Three-column grid: branding + nav links + contact. Below: a giant ghost logotype — `text-[9vw]`, transparent fill with `-webkit-text-stroke` in accent color at `opacity-30`. This creates a powerful brand stamp without being literal.

---

## 6. MOTION RULES

| Effect | Duration | Easing | Property |
|---|---|---|---|
| Hover color/opacity | 300ms | default | `transform`, `opacity` |
| Image scale | 700ms | default | `transform` |
| Arrow slide | 300ms | default | `transform` |
| Scroll reveal | 800ms | `cubic-bezier(0.16, 1, 0.3, 1)` | `transform`, `opacity` |
| Mobile menu | 500ms | `ease-in-out` | `transform` |
| Name plate slide | 500ms | default | `transform` |

**Rules:**
- Animate ONLY `transform` and `opacity`. Never `width`, `height`, `top`, `left`.
- Image scale on cards is intentionally slow (`700ms`) — slower = more premium.
- Use `group` + `group-hover:` for all compound hover states.

---

## 7. RESPONSIVE CONTRACTS

- **Hero heading:** `text-3xl` → `text-5xl` → `text-6xl` → `text-[80px]`.
- **Grids:** Always start `grid-cols-1`, expand at `md:` and `lg:`.
- **Split layouts:** `col-span-5` image + `col-span-7` content on desktop. Stack vertically on mobile.
- **Navbar:** Compact pill with hamburger on mobile; full nav on `md+`.
- **Section padding:** Maintain `py-section-y` across all breakpoints.

---

## 8. ADAPTATION GUIDE

To re-skin this system for another brand:
1. Change `--color-accent` to any electric/neon hue.
2. Swap the font pair: keep one geometric display (like Unbounded) + one neutral body (like Roboto).
3. Adjust section order as needed, but **preserve the alternation rhythm**.

Component shapes, motion rules, and layout contracts must stay constant — they are what make the system feel premium.

---

## 9. PRE-OUTPUT CHECKLIST

Evaluate your code before delivering:
- [ ] Only one accent color exists; everything else is black, white, or gray.
- [ ] No gradients anywhere. All sections are flat color.
- [ ] Headings are uppercase Unbounded; body is Roboto.
- [ ] Pill CTAs include the sliding text + double-arrow animation.
- [ ] Section backgrounds alternate dark/light without adjacent dark sections.
- [ ] Dark cards use `#272727`, not pure black.
- [ ] Image cards on dark use `mix-blend-luminosity` with grayscale-to-color hover reveal.
- [ ] All hover effects use `group-hover:` with `transform` only.
- [ ] Scroll reveal animation is present on every section.
- [ ] Footer includes the giant ghost logotype with `-webkit-text-stroke`.
- [ ] The overall impression feels like a $150k agency build, not a generic template.
