# Mobile redesign — parliament navy + glass

Date: 2026-05-21 · Status: validated design, executing

A visual overhaul of `apps/mobile` toward a deep parliament-navy theme with
frosted-glass chrome and slicker frames/buttons/avatars/scores — the goal is a
mobile UX that reads as if designed by Apple's HIG team. No data, query, or API
changes: this is a pure presentation pass. `apps/mobile` stays a pure client of
`apps/web`'s `/api/*` (see `2026-05-19-mobile-capacitor-wrap.md`).

## Decisions (locked with the user)

- **Accent:** keep the existing teal `#6ADCC5` — it pops on navy and avoids
  re-theming every accent consumer.
- **Shape:** "tight modern" — keep the smaller radii (7–10px), tighten borders
  and spacing. Not large Apple squircles.
- **Surfaces:** glassy / translucent — frosted blur + inner top-highlight on the
  framing surfaces; depth via light, not hard borders.
- **Avatars:** flat circle with a slick ring + lift. No gradient identicon.
- **Ranks:** top-3 get teal/gradient emphasis; rest stay muted mono.
- **Scope:** three screens — `/traders`, `/assets`, `/feed` (+ shared shell).
  Detail pages (`/trader/[address]`, `/assets/[coin]`) and Capacitor are a later
  phase.

## Why this is mostly a token edit

Almost every component reads from the `--stripe-*` variables in `:root` and the
`@theme` tokens in `apps/mobile/src/app.css`. Retuning those tokens propagates
the navy palette to all three screens and the content pages automatically. Glass
and the slicker buttons/avatars/scores need targeted edits on top.

## Color foundation (`app.css` `:root` + `@theme`)

Parliament-navy scale stacked by elevation:

```
--bg-deep:      #0A1A30   page background (deepest)
--bg-primary:   #0F2440   cards / rows resting surface
--bg-secondary: #163052   raised (chips, inputs, avatars)
--bg-tertiary:  #1E3D63   hover / pressed fills
--bg-elevated:  #284B73   highest (active states, badges)
```

Accent kept; subtle fills warmed for navy:

```
--accent: #6ADCC5   --accent-subtle: rgba(106,220,197,0.16)
```

Semantics retuned for AA contrast on navy:

```
--success: #2BE3B5   --danger: #FF6B6B
```

Text opacity ladder on white (AA on navy): primary .95 / secondary .72 /
tertiary .50 / muted .34.

Cool-tinted hairline borders so frames read as glass edges:

```
--border:       rgba(150,190,255,0.12)
--border-light: rgba(150,190,255,0.18)
```

`bg-glow` / `bg-grid` atmosphere layers re-tinted teal-on-navy.

## Glass tokens

```
--glass-bg:        rgba(18, 40, 72, 0.55)
--glass-blur:      blur(18px) saturate(140%)
--glass-highlight: inset 0 1px 0 rgba(255,255,255,0.06)
--glass-shadow:    0 4px 24px rgba(0,0,0,0.35)
```

Applied to framing surfaces only — fixed chrome (header/bottom nav) and
container panels (list wrap, cards) — not every row, to stay at 60fps.

## Component pass

- **Buttons** — primary: teal gradient fill, navy text, top highlight, press
  glow + `scale(0.97)`. Secondary: glass-navy + teal text + brightening border.
- **Avatars** — flat circle, slick ring + `--glass-shadow` lift; navy fallback.
- **Score pill** — glass teal-tinted capsule, teal number, micro "SCORE" label.
- **Chips** (sort/filter/tag/tabs) — pill, glass-navy resting, teal-subtle +
  border + faint glow active.
- **Ranks** — top-3 teal emphasis; rest muted mono.
- **Lists** — iOS inset-grouped pattern: list is one frosted glass panel,
  rows are hairline dividers within it.
- **Micro-interactions** — unified on `--motion-ease`, 120ms press feedback.

## Rollout order

1. `app.css` `:root` + `@theme` tokens (navy + glass).
2. `app.css` shared component classes.
3. `+layout.svelte` shell (frosted header + bottom nav).
4. Three screens + row components (traders/assets/feed).
5. `prefers-reduced-transparency` / `-motion` solid fallbacks.

## Verification

Run the app at :5174 in a narrow viewport, walk all three screens (golden path +
loading/empty/error states), confirm 60fps scroll, run `pnpm check`.

## Out of scope

- Detail pages `/trader/[address]`, `/assets/[coin]`.
- Capacitor wrap (next phase — see `2026-05-19-mobile-capacitor-wrap.md`).
