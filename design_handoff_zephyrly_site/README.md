# Handoff: Zephyrly design system → your site

## Overview
This bundle hands the **Zephyrly design system** to Claude Code so it can build/style
your site consistently with the brand. Zephyrly is a calm, offline-aware task app; the
whole personality is *calm* — quiet surfaces, soft elevation, gentle copy, and one warm
signature: a yellow radial glow in the bottom-right corner of every screen.

## About the design files
The files here are **design references**, not production code to paste in verbatim.
The task is to **apply this design system inside your site's existing environment**
(React, Vue, plain HTML/CSS, etc.) using its established patterns — or, if the project
doesn't have styling conventions yet, to wire these tokens in as the foundation.

The token CSS files (`design-system/tokens/*.css`) and `design-system/styles.css` *are*
directly usable — they're plain CSS custom properties. Import them and build against the
`var(--*)` tokens rather than hardcoding values.

> Note: this design system was reverse-engineered from the repo
> **`isaacshmidman/charcoal-peak-taskflow`** (branch `codex/taskflow-hardening`) — a
> React + Vite + Tailwind + shadcn/ui app. If that IS your site's repo, most of this
> already exists in `src/index.css` and `tailwind.config.js`; this bundle is the
> distilled, documented version to keep new work on-brand.

## Fidelity
**High-fidelity.** All colors, typography, spacing, radii, and shadows below are exact,
production values. Recreate UI pixel-accurately against these tokens.

---

## How to integrate (Claude Code steps)

1. **Drop in the tokens.** Copy `design-system/tokens/*.css` and `styles.css` into the
   project (e.g. `src/styles/zephyrly/`). Import `styles.css` once at the app root — it
   `@import`s all the token files. Self-host the fonts from `design-system/assets/fonts/`
   (Plus Jakarta Sans, weights 400/500/600/700/800) via `tokens/fonts.css`.
2. **Set the page background** on `<body>` — this is THE brand element, don't skip it:
   ```css
   body {
     background: var(--brand-bg-light);      /* radial glow, bottom-right corner */
     background-attachment: fixed;
     background-repeat: no-repeat;
     color: var(--text-body);
     font-family: var(--font-sans);
   }
   ```
   Dark mode: add `.dark` on `<html>`/`<body>` → switches to `var(--brand-bg-dark)` and
   the dark token scope automatically.
3. **Build against tokens, never raw hex.** Use `var(--slate-500)`, `var(--radius-xl)`,
   `var(--shadow-sm)`, etc. If the codebase uses Tailwind, the slate ramp / radii / spacing
   already map to Tailwind's `slate`, radius, and 4px scale.
4. **Match the component contracts** in the "Components" section below — the design system
   ships React components (`Button`, `Input`, `Checkbox`, `Badge`, `Card`, `TaskCard`);
   recreate them with the same variants/states in your framework.

---

## Design tokens (exact values)

### Brand
| Token | Value | Use |
|---|---|---|
| `--brand-bg-light` | `radial-gradient(circle at 100% 100%, #f5f5a0 0%, #fdfdcf 12%, #ffffff 40%)` | page background (fixed) |
| `--brand-bg-dark` | `radial-gradient(circle at 100% 100%, #343422 0%, #1d1d14 16%, #0b0b08 38%, #000000 66%)` | dark page background |
| `--brand-glow-1` / `--brand-glow-2` | `#f5f5a0` / `#fdfdcf` | glow stops |
| `--brand-yellow` | `#f3e23f` | logo wave accent |
| `--brand-ink` | `#0a0a0a` | logo "Z" |

The yellow is **atmosphere, not a fill** — there is no colored brand button.

### Neutrals (slate — the real neutral ramp)
`--slate-50 #f8fafc` · `100 #f1f5f9` · `200 #e2e8f0` · `300 #cbd5e1` · `400 #94a3b8` ·
`500 #64748b` · `600 #475569` · `700 #334155` · `800 #1e293b` · `900 #0f172a` · `950 #020617`

Roles: body text `--text-body` (slate-900) · secondary `--text-secondary` (slate-500) ·
muted/meta/placeholder `--text-muted` (slate-400) · faint `--text-faint` (slate-300).
Borders: `--border` slate-100 (hairline) · `--border-strong` slate-200 (inputs/dividers).

### Semantic & status
- Primary action: `--primary` slate-900, white text, hover `--primary-hover` slate-800.
  **Inverts to light in dark mode.**
- Surfaces: `--surface-card` #fff · `--surface-card-glass` rgba(255,255,255,0.8) (sticky
  header + backdrop-blur) · `--surface-muted` slate-50.
- Destructive: `--destructive` #ef4444 · `--destructive-soft` #f87171 (overdue bar / swipe).
- Recurring accent: `--accent-recurring` violet-600 `#7c3aed` (dot/chip).

### Priority palette
Task cards tint by priority: a saturated `-400` dot over a `-50` wash with a `-100`
hairline, across red/orange/yellow/green/blue/violet/pink/teal/cyan/rose (+ gray/black).
See `design-system/tokens/priority.css` for the full set.

### Typography
- Family: **Plus Jakarta Sans** (`--font-sans`), self-hosted. Wordmark "Z" uses 800 ExtraBold.
- Scale: page headings 16px/600 · hero/auth headline 24px · body & most UI 14px/500 ·
  secondary 12px · meta/date chips 10–11px. Headings track tight (`-0.02em`).
- Weights: 400 / 500 (default interactive) / 600 (headings) / 700 / 800 (wordmark).

### Spacing / layout (4px base)
Content column `--container-max` 72rem, 24px gutters · sticky top bar `--header-height` 56px ·
controls `--control-height` 36px · auth fields & CTA `--control-height-lg` 48px · list gap 8px.

### Radii
`--radius-md` 6px (buttons, checkboxes) · `--radius-lg` 8px (chips, small cards) ·
`--radius-xl` 12px (task cards, panels) · `--radius-2xl` 16px (auth inputs) ·
`--radius-3xl` 28px (hero/auth card) · `--radius-full` (dots, avatars).

### Shadows (whisper-soft)
`--shadow-sm` 0 1px 3px rgba(15,23,42,.06)… (cards) · `--shadow-pop` 0 8px 28px rgba(15,23,42,.12)
(popovers/menus) · `--shadow-hero` 0 24px 80px rgba(15,23,42,.08) (auth card).

### Motion
Easing `--ease-standard` cubic-bezier(0.4,0,0.2,1). Durations: `--duration-fast` 100ms
(card enter, completion toggle) · `--duration-base` 200ms (hover, nav, swipe-settle).
Quick and gentle, **no bounce**, no decorative loops.

---

## Components to recreate
Match these contracts (React source in the design system repo under `components/`):

- **Button** — variants: primary / secondary / outline / ghost / destructive / link;
  sizes incl. icon. Primary = slate-900 fill, white text, hover slate-800. 36px tall,
  6px radius. No colored brand fill.
- **Input** — text field, slate-200 border, soft 2px focus halo in `--ring`. Auth variant
  is 48px tall, 16px radius.
- **Checkbox** — the signature ink-fill task checkbox (fills slate-900 when checked).
- **Badge** — status chips / recurrence labels / tag dots. 8px radius.
- **Card** — base white surface, 1px slate-100 hairline, 12px radius, `shadow-sm` on hover.
- **TaskCard** — the signature row: priority wash fill/border, 4px left bar that turns
  `--destructive-soft` when overdue, recurrence chip (violet), date chip. Done state:
  fade to ~55% opacity + strikethrough title. Swipe-to-delete reveals a red peel.

## States (apply throughout)
- Hover: primary darkens to slate-800; ghost/quiet controls fill slate-50; cards gain shadow-sm.
- Focus: 1px ring in `--ring`; inputs get a soft 2px halo.
- Done: 55% opacity + strikethrough.
- Disabled: 50% opacity, no pointer.

## Content / voice
Calm, human, quietly poetic — weather/stillness metaphors for empty states
("Clear skies. Add something when you're ready."). Sentence case everywhere. Terse copy,
1–2 word buttons. Reassuring system messages with undo, never alarmist. **No emoji.**

## Assets
- `design-system/assets/zephyrly-logo.png` — app icon (black Z on wavy yellow; rounded in lockups).
- `design-system/assets/zephyrly-icon.svg` — favicon (black Z on `#f5f5a0`).
- `design-system/assets/fonts/plus-jakarta-sans-{400,500,600,700,800}.woff2` — brand typeface.

## Files in this bundle
- `design-system/styles.css` — `@import` manifest; import this once.
- `design-system/tokens/{colors,priority,typography,spacing,fonts}.css` — the tokens.
- `design-system/assets/` — logo, favicon, self-hosted fonts.

## Deeper reference
Full component source, UI-kit demos (Login / Today / All Tasks / Completed), and specimen
cards live in the design-system repo **`isaacshmidman/charcoal-peak-taskflow`**
(`src/components/`, `src/index.css`, `tailwind.config.js`). Explore there when you need
exact component internals.
