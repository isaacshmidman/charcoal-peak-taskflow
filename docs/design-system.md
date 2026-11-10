# Zephyrly design system — "Daylight"

Introduced November 2026. It replaces the system described in
`design_handoff_zephyrly_site/`, which is kept only as a record.

The idea in one line: **paper, ink, and one clean wash of sun.** Two
colours carry the brand, there is a single gradient, and most of the
screen is left alone.

The values live in `src/styles/zephyrly.css` (CSS variables) and
`tailwind.config.js` (the class names). `src/index.css` holds the shadcn
variables and a few shared classes. Change a colour there, not in a
component.

## Colour

| Scale | What it is | Used for |
| --- | --- | --- |
| `ink-50 … ink-950` | A warm near-black and its greys | Text, lines, quiet fills, the primary button in the light |
| `sun-50 … sun-950` | The brand lemon, pale to deep | The page wash (pale end), the accent (`sun-400`), text on a yellow tint (`sun-700+`) |
| `night-*` | Dark-mode surfaces, warm like the ink | `base` page, `card`, `sunken` fields, `raised` hover, `line` hairlines |

Rules:

- **Ink is the neutral.** It is deliberately not a blue-grey: it shares the
  yellow's warmth, which is what lets the two sit together. Don't reach for
  Tailwind's `slate`, `gray` or `zinc`.
- **Sun is the only accent.** Where it appears as a solid fill it means one
  of three things: *done* (a ticked box), *now* (today on a calendar), or,
  in the dark, *the main action* (the primary button). Selection is a quiet
  ink tint (`bg-selected`), not yellow.
- **Yellow highlight inside a note still means "this is a task."** That rule
  is older than this system and unchanged.
- **Red is for trouble only**: overdue, delete, errors.
- **Priority colours** belong to the person (they pick them in Settings). In
  a list they colour the tick box (`colorCheck`); on the calendar they tint
  the chip (`colorBg`). Rows and columns themselves stay plain.

## The wash

One gradient: the top of the page is `sun`, fading down into paper within
300px (`--wash-light`, `--wash-dark`). The top bar (`.ds-bar`) takes the
same colour, so it has no edge. There are no other gradients on the page;
`bg-sun-gradient` exists for the logo tile and the rare badge.

`index.html` carries a literal copy of the wash so it paints before the
stylesheet loads. If you change one, change both.

## Type

Hanken Grotesk, one variable file, self-hosted in `public/fonts` (SIL Open
Font Licence, text beside the files).

- Page title: `.ds-page-title` (26px, weight 650, tight tracking), with
  `.ds-page-sub` under it.
- Body and rows: 14–15px, weight 500 for a title, 400 for prose.
- Meta (dates, tags, counts): 11–12px in `ink-500`, plain text. Not chips.
- Numbers that line up (times, dates) get `tabular-nums`.

`cn()` runs classes through tailwind-merge, which reads the custom sizes
`text-2xs` / `text-xs2` as colours and drops them when a real text colour
follows. Inside `cn()`, write `text-[11px]` instead.

## Shape

- Controls: 8px corners (`rounded-lg`), 36px tall.
- Surfaces: 12px (`rounded-xl`). Dialogs 16px. The sign-in card 20px.
- **No shadows on things that sit on the page.** Cards and buttons are
  flat. Only what floats — menus, popovers, dialogs, the undo toast — gets
  `shadow-pop`.
- Hairlines (`border-border-hairline`) do the dividing.

## Building blocks

| Thing | Use |
| --- | --- |
| A list of rows | Wrap in `.ds-list`. One surface, hairlines between rows, no gaps. Rows bring no border or radius of their own. |
| A choice of a few (Day · Week · Month) | `.ds-seg` around `.ds-seg-item` buttons; mark the chosen one `aria-pressed="true"`. |
| A card | `ui/Card`. |
| A tick box | `ui/Checkbox` (pass `tone` for a priority-coloured ring). |
| Buttons | `ui/Button`: `default` (ink in the light, sun in the dark), `outline`, `ghost`, `destructive`. Small square "add" buttons are `outline`. |
| The logo | `components/Logo.jsx`. The PNG app icons are renders of `public/icon.svg`: `node scripts/render-icons.mjs`. |

## Dark mode

Not an inversion. The page is a warm near-black (`night-base`), never pure
black; cards are one step lighter; the wash is a deep olive-amber. The
primary button becomes sun with ink text, which is where the brand shows
most. Use the surface names (`bg-surface-card`, `border-border-hairline`)
where you can — they swap by themselves — and `dark:` with a `night-*` name
where you can't.

## What to avoid

These are what the redesign removed. Putting them back undoes it.

- A tinted, bordered, rounded card for every item in a list.
- A different pastel per column, per section, per state.
- Chips with borders around every tag and date.
- Shadows on resting cards; outlines doubled up with rings.
- A second accent colour (purple for "repeats", blue for "today").
- Pure black, or blue-grey, anywhere.
