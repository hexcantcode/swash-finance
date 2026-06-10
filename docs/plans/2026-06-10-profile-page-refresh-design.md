# Mobile profile page — refresh design

Date: 2026-06-10 · Status: approved, implementing
Supersedes the *scope* (not the data architecture) of
`2026-05-29-profile-page-design.md` for the current release: pure design
pass, mock data only, no connect flow, no endpoints.

## Context

Since the May 29 design: Mirror is a polished coming-soon placeholder
app-wide (shared sheets via `appSheet`), mobile is a pure `/api` client,
and the app's surface language is light liquid glass. The user loves the
balance hero; the rest of the page gets designed as if live, labeled
honestly, fed by one mock fixture.

## Page assembly

Hero → **Your mirrors** → **Open positions** → **Latest transactions**.
Home-page section rhythm (`safe-x`, `--space-4` gaps). The hero's
staggered-rise animation extends down the page one beat per section
(0/80/160/240ms), zeroed under `prefers-reduced-motion`.

All data comes from a single `MOCK_PROFILE` fixture const in
`routes/profile/+page.svelte` — future wiring is a one-spot swap. No
fetches → no loading/error states yet (that machinery stays specced in
the May 29 doc). Zero new components; only page-scoped CSS.

## Sections

**Balance hero — premium glass.** Keep structure, typography (dimmed
$/cents), bell, change pill, recessed Withdraw/Deposit/History pocket,
staggered rise. Change: surface becomes glass (`--glass-bg` +
`--glass-blur` + hairline + `--glass-highlight`) with the two
`--stripe-accent-muted` radial washes and the grain kept on top — same
material as the app, lit as the hero. Drop the dark-era text-shadow on
the amount. Add a small `Preview` chip next to the "Balance" label — the
only acknowledgment the numbers are fixtures.

**Your mirrors — coming-soon teaser.** Section title + the standard
"Coming soon" badge. One `.m-list` glass panel, three mock leader rows
using real leaderboard addresses (hardcoded, deterministic): effigy 28px
· short address · weight chip (50/30/20%) · 30D contribution profit,
sign-colored. Row tap → `/trader/[address]` (really works). Footer
`Edit allocation →` opens the Mirror coming-soon sheet. **Designed for
deletion:** the minimal variant (drop this section) is one `{#if}` block
away — user wants to try that next.

**Open positions.** Trader-detail row anatomy: coin icon with
side-colored ring · name + `long · 3x` line (leverage folded into the
side text, per app convention) · right: position size over unrealized
profit. 4 mock rows mixing green/red.

**Latest transactions.** Header + quiet `Last 20` caption. Rows: coin
icon · `BTC · buy` / `ETH · sell` (buy/sell colored — these are fills,
never long/short) · caption line with relative time + `0.42 @ $43,287` ·
right: realized profit for closes, `—` for opens. 6 mock fills. No
"View all" links (no dead taps; routes don't exist yet).

## Out of scope (unchanged from May 29 doc)

Connect flow, real endpoints, Manual/Mirror mode machinery, wallet
activity section, View-all routes, pull-to-refresh.
