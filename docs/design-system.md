# Zephyrly design system — "Daylight"

Introduced November 2026. It replaces the system described in
`design_handoff_zephyrly_site/`, which is kept only as a record.

The idea in one line: **paper, ink, and a little sun.** Two colours
carry the brand, the page is flat, and most of the screen is left alone.

The values live in `src/styles/zephyrly.css` (CSS variables) and
`tailwind.config.js` (the class names). `src/index.css` holds the shadcn
variables and a few shared classes. Change a colour there, not in a
component.

## Colour

| Scale | What it is | Used for |
| --- | --- | --- |
| `ink-50 … ink-950` | A warm near-black and its greys | Text, lines, quiet fills, the primary button in the light |
| `sun-50 … sun-950` | The brand lemon, pale to deep | The accent (`sun-400`), a pale tint behind "today" (`sun-100`), text on a yellow tint (`sun-700+`) |
| `night-*` | Dark-mode surfaces, warm like the ink | `base` page, `card`, `sunken` fields, `raised` hover, `line` hairlines |

Rules:

- **Ink is the neutral.** It is deliberately not a blue-grey: it shares the
  yellow's warmth, which is what lets the two sit together. Don't reach for
  Tailwind's `slate`, `gray` or `zinc`.
- **Sun is the only accent.** Where it appears as a solid fill it means one
  of three things: *done* (a ticked box), *now* (today on a calendar), or,
  in the dark, *the main action* (the primary button). Selection is a quiet
  ink tint (`bg-selected`), not yellow.
  In the small pop-up date picker, today is a sun *dot*, not a fill: the
  fill there belongs to the day you picked, and two filled days in two
  colours read as two selections.
- **Yellow highlight inside a note still means "this is a task."** That rule
  is older than this system and unchanged.
- **Red is for trouble only**: overdue, delete, errors.
- **Priority colours** belong to the person (they pick them in Settings). In
  a list they colour the tick box (`colorCheck`); on the calendar they tint
  the chip (`colorBg`). Rows and columns themselves stay plain.

## The page

Flat paper (`--surface-page`), edge to edge, in the sidebar and behind
every page. Until November 2026 a wash of sun faded down from the top of
each page; it went when the sidebar arrived, because a gradient across
the top is what made the app look like a landing page. Yellow now only
ever means something: done, now, or (in the dark) the main action.
`bg-sun-gradient` exists for the logo tile and the rare badge.

`index.html` carries a literal copy of the paper colours so the page
paints before the stylesheet loads. If you change one, change both.

## Getting around

One map, in `src/lib/navigation.js`: Home, Today, Calendar, Tasks, Notes.
The app opens on Home unless the person chose another page. The
board and Completed are views of Tasks (a switch at the top of each,
`tasks/TasksViewSwitch.jsx`), not places of their own, though each keeps
its address so links and Back land where they meant.

- **From a tablet up: a sidebar** (`nav/Sidebar.jsx`). Name, search (the
  command palette), the places in the person's order with a count beside
  Today and Tasks, then tags, then Recently deleted and Settings at the
  foot. On a wide screen it shows words and can be folded to a rail of
  icons; between phone and laptop it is always the rail.
- **On a phone: a tab bar** (`nav/PhoneTabs.jsx`). A word under every
  icon. The first three places, adding in the middle, and More for the
  rest. The page header's "New task" button is hidden on a phone: the
  tab bar's + is the way to add.
- **Tags are places too.** A tag in the sidebar opens Tasks narrowed to
  it (`?tag=`), and stays chosen across List, Board and Completed.
- **A count is the rows behind it.** The sidebar and the pages ask the
  same questions (`src/lib/task-views.js`); don't count a second way.
- **Width.** Pages you read down (lists, Settings) are a column
  (`max-w-4xl`); pages you look across (the calendar, the board, Notes)
  take the whole width; Home's grid stops at `max-w-7xl`. `Layout.jsx`
  decides, by address.
- Nothing sits across the top of a page. A page starts with its own
  `PageHeader`, which stays put while the page scrolls.

## Home

`pages/Home.jsx`: a grid of blocks, each a small view of something
another page shows in full. The person arranges it; nothing arranges
itself.

- **A block** is `home/HomeBlock.jsx`: a card with a quiet heading that
  is the link to the full page, a count beside it, and the content from
  `home/blocks.jsx`. Six columns on a laptop (a block is a third, a half
  or the whole row), two on a tablet, one on a phone.
- **The numbers** come from `src/lib/home-blocks.js`, plain functions
  over the tasks and notes already loaded, tested on their own. Today
  plus Overdue is exactly the Today page's list. Add a block there
  (`HOME_BLOCKS`, a function for its data) and in `Home.jsx` (`parts`).
- **Customize** turns the page into its own editor: each block gets
  earlier / later, S M L, and remove; a tray at the foot lists the blocks
  that are off the page. Content is held still while arranging. Every
  change is saved at once to the account (`backend/home-layout.js`), so
  it is the same page on every device. Reset forgets it.
- **Colour.** Bars and dots are ink. Sun appears where it always means
  something: today's bar and today's date (now), the progress bar (done).
  An event's stripe in Schedule is its calendar's own colour.
- **Quick add** reads `#tag` and `!priority` like the task form's title.
  The day is the switch beside it. Words are never read for dates.

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
| An on/off switch | `ui/Switch` (`checked`, `onChange`, `label`). |
| A page's top | `components/PageHeader.jsx` — title, sub-line, actions; it stays put while the page scrolls. `PageSearch` is its search button. Every quiet icon button in a header takes `headerIconButton` from the same file, so search, sort and the rest are one grey. |
| The x that empties a box or removes a row | `ui/clear-button.jsx`: `ClearButton` (faint, red under the pointer). Every search box shows one once something is typed. |
| A page inside Settings | `settings/parts.jsx`: `SettingsSection` (a quiet label over one surface), `SettingRow` (name left, control right) and `SettingsLink` on a `.ds-list`, `ReorderButtons`. Sentence-case labels; no card per row; no heading heavier than the label. |
| A board that fills the screen | `pages/Groupings.jsx`: the page is exactly the screen's height, columns scroll inside themselves, and sideways wheel movement anywhere on the page is handed to the board (`useSidewaysScroll`). |
| Two columns with a divider you can drag | `ui/TwoPane` (Notes, the calendar's day view). |
| A form in a dialog | `tasks/TaskForm/parts.jsx`: `FormDialog` (quiet heading, a body that scrolls, a footer that stays), `Field` (one property per line: label left, control right), `DateField` (the date button and its pop-up). The task form and the subtask form are both built from these. |
| A text box | `ui/Input`, `ui/Textarea`. 16px on phones (anything smaller makes iOS zoom the page), 14px from tablets up — the primitive does this, so don't set a size at the call site. No hand-rolled `<input>` borders, no native tick boxes: `ui/Checkbox` and `ui/Switch`. |
| Rich text | `tasks/RichDescriptionEditor.jsx`. Its format bar arrives on first focus and then stays (quieter when you're elsewhere); its menus float in a portal so nothing can cut them off; on a touch screen the bar is one line that scrolls sideways. A link looks the same everywhere: ink, sun underline. |
| Picking a date | `ui/Calendar`. The picked day is the only filled one; today is a small sun dot under its number. |
| The logo | `components/Logo.jsx`. The PNG app icons are renders of `public/icon.svg`: `node scripts/render-icons.mjs`. |

## Dark mode

Not an inversion. The page is a warm near-black (`night-base`), never pure
black; cards are one step lighter. The
primary button becomes sun with ink text, which is where the brand shows
most. Use the surface names (`bg-surface-card`, `border-border-hairline`)
where you can — they swap by themselves — and `dark:` with a `night-*` name
where you can't.

## Nothing moves under the pointer

A click is a press and a release, and focus leaves the old box on the
*press*. So anything that changes the layout when a box loses focus —
a toolbar that hides, a typed tag turning into a chip, a new row — moves
the control being clicked before the button comes up, and the click
misses. Three rules keep that from happening:

- Chrome that appears on focus stays once it has appeared.
- Tidying on blur goes through `afterPress()` (`src/lib/afterPress.js`),
  which waits for the click and runs just ahead of it.
- A form dialog hangs from the top (`FormDialog`), so growing never moves
  what is above the new row. A centred dialog re-centres every time.

`e2e/task-flows.spec.ts` has a `humanClick` helper that holds the button
down for a moment; Playwright's own `click()` is too quick to catch this.

## What to avoid

These are what the redesign removed. Putting them back undoes it.

- A tinted, bordered, rounded card for every item in a list.
- A different pastel per column, per section, per state.
- Chips with borders around every tag and date.
- Shadows on resting cards; outlines doubled up with rings.
- A second accent colour (purple for "repeats", blue for "today").
- Pure black, or blue-grey, anywhere.
- A gradient behind the page, and navigation centred across the top.
