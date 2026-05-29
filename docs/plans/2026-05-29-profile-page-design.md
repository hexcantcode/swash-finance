# Mobile profile page — design

Date: 2026-05-29 · Status: design approved, implementation pending

`/profile` is the connected user's account dashboard. Until now it has been
a static balance hero with inert Withdraw / Deposit / History buttons; this
design rounds it out into the screen a user actually opens to *see what
they hold and what's moving*.

The page reads as an exchange dashboard with one copy-trading twist: an
account is either in **Manual** mode (user runs their own positions) or
**Mirror** mode (user allocates capital across N leader wallets). The two
modes are mutually exclusive — switching is a real account action, not a
view filter.

## Goal

A profile page that:

1. Works when no wallet is connected (single decision: Connect Wallet).
2. Works when a wallet is connected, in either Manual or Mirror mode.
3. Surfaces the three things a copy-trading user keeps coming back for:
   open positions, recent fills, and money in/out.
4. Reuses the canonical data layer in `apps/web` — mobile never queries
   the DB directly, per `CLAUDE.md` STRICT RULE.

## Architecture

```
/profile
├── disconnected → <ConnectWalletScreen>      (no data fetch)
└── connected    → <ProfileScreen>
                     ├── <BalanceHero>        (existing, rewired)
                     ├── <PositionsSection>   (mode-aware)
                     │     ├── Manual:  <PositionsList>
                     │     └── Mirror:  <MirrorBook> + <PositionsList weighted>
                     ├── <LatestFillsCard>
                     └── <WalletActivityCard>
```

`<ConnectWalletScreen>` is local-only — no fetches, no spinners.

`<ProfileScreen>` composes four independent fetches. Each section owns its
loading / error / empty state; the page never blocks on the slowest source.

### Data sources

| Section | Endpoint | Status |
|---|---|---|
| Balance hero | `/api/profile/summary?address=…` | **New.** Returns `account_value`, `change_today_usd`, `change_today_pct`, 30D equity curve. |
| Positions (Manual) | `/api/holdings?address=…` | Already scaffolded under `apps/web/src/routes/api/holdings/` — reuse. |
| Positions (Mirror, weighted) | Aggregates client-side from `/api/holdings` calls per leader, weighted by the mirror book. | Client-side composition; no new endpoint. |
| Mirror book | `/api/profile/mirror?address=…` | **New domain.** Returns `[{ leader, weight, pnl_contribution_usd }]`. **Mock for now:** hardcoded fixture in the client. Real impl needs a `mirror_subscriptions` table. |
| Latest fills | `/api/profile/fills?address=…&limit=20` | **New.** From `fills` table, newest first. |
| Wallet activity | `/api/profile/transfers?address=…&limit=20` | **New.** Canonical source = HL `userNonFundingLedgerUpdates`. Confirm worker ingests this before shipping real data. |

### Mode state

Manual vs Mirror is a per-account attribute, not a view filter.

- **Mock:** Svelte rune backed by `localStorage` (`'manual' \| 'mirror'`).
- **Real:** a `users.mode` column lands with wallet auth.

Switching modes is a heavy action (affects deposited capital) and lives
behind a small "Switch mode →" link in the Positions section header, not a
casual toggle.

## Disconnected state

A single full-bleed glass panel replaces the balance hero. Page chrome
(top header, bottom nav) stays — `/profile` is still a tab.

```
┌─────────────────────────────┐
│  Your account on Swash      │  --type-title, 600
│                             │
│  Mirror the right traders.  │  --type-footnote
│  Or run your own positions. │  tertiary
│  One wallet, your call.     │
│                             │
│  ┌─────────────────────┐    │
│  │   Connect Wallet    │    │  .m-btn, full-width
│  └─────────────────────┘    │
│                             │
│  We never custody your funds│  --type-caption
└─────────────────────────────┘
```

**Connect handler.** CTA fires `connectWallet()` — today a shim that toggles
a `connected = true` rune. Real impl plugs into the Capacitor wallet
provider when that lands (per the wrap plan's "Auth / wallet" TODO).

**States.**
- `idle`: screen above.
- `connecting`: inline spinner, label flips to "Connecting…", disabled.
- `error`: destructive-tinted footnote below the CTA — *"Couldn't connect.
  Try again."* CTA stays tappable.

**Motion.** Reuses the staggered rise the existing balance hero already
animates, tightened — headline → copy → CTA in three quick beats (0, 80ms,
160ms). Respects `prefers-reduced-motion`.

## Connected — balance hero

Existing component, minimal changes:

- Wire numbers to `/api/profile/summary`: `account_value`,
  `change_today_usd`, `change_today_pct`.
- No mode badge on the hero (mode lives in the Positions section header).
- Withdraw / Deposit stay inert until the wallet integration. **History**
  button scrolls to the Wallet activity card below.

## Connected — Positions section (mode-aware)

Section header: `Positions` (`--type-headline`) + right-aligned, small
`--type-footnote` link "Switch mode →".

In Mirror mode the header label flips to `Mirroring N leaders`.

### Manual mode

Glass card list of position rows. Each row reuses the holdings shape from
`MobileTraderCard.svelte` (coin icon · long/short border ring · symbol ·
size · current PnL, sign-colored).

**Empty:** *"No open positions. Trades will appear here as soon as you
have an open position."*

### Mirror mode — two sub-sections

**(a) Mirror book.** Compact glass card listing each mirrored leader:

- effigy avatar (22px) · short address · weight % chip (`12.5%`) · 30D
  contribution PnL ($, sign-colored).
- Tapping a row → `/trader/[address]`.
- Card footer link: `Edit allocation →` (inert in the mock, opens a sheet
  later).

**(b) Aggregated positions.** Single weighted positions list, same row
shape as Manual mode. Each row carries a `--type-caption` chip indicating
provenance: `via 0xabc…` (one leader) or `+3 leaders` (many). Tapping a
position deep-links to `/assets/[coin]`.

**Empty (no leaders selected):** the page's one promotional empty — a card
with `Pick traders to mirror →` routing to `/traders`. Everywhere else,
empty = quiet copy.

## Connected — Latest transactions (fills)

Header: `Latest transactions` + right-aligned `--type-footnote` window
chip ("Last 20"). Card footer: "View all →" → `/profile/fills` (TODO
route).

**Row anatomy.**

- **Left:** coin icon 20px with long/short border ring.
- **Middle (stacked):** line 1 = `BTC LONG` / `ETH SHORT`, `--type-subhead`
  mono, weight 500. Line 2 = `--type-caption` tertiary: relative time
  (`12M AGO`) + `·` + size+price (`0.42 @ $43,287`). Reuses
  `formatRelative()` from `MobileTraderCard.svelte`.
- **Right:** realized PnL when closing fill (sign-colored,
  `--type-subhead` mono); `—` for opening fills.

**In Mirror mode:** each row carries a `--type-caption` chip "via 0xabc…"
(the leader whose execution drove the mirror).

**Empty:** *"No transactions yet. Your trades will appear here within
seconds of execution."*

**Loading:** 5 skeleton rows, same proportions as `.m-skeleton-row` on
/traders.

## Connected — Wallet activity (deposits / withdrawals)

Header: `Wallet activity`. Card footer: "View all →" → `/profile/transfers`
(TODO route).

**Row anatomy.**

- **Left:** 18px direction icon — Deposit ↑ / Withdraw ↓ paths reused from
  the hero's action bar. Tinted success / danger.
- **Middle (stacked):** line 1 = `Deposit` / `Withdraw`, `--type-subhead`,
  500. Line 2 = `--type-caption` tertiary: relative time + `·` + counter
  party short form (`from 0xabc…` / `to 0xdef…`) or chain name
  (`Arbitrum`).
- **Right:** USD amount, mono, sign-colored — green-plus for deposits,
  red-minus for withdrawals.

Row tap opens a bottom sheet with the txn hash and an explorer link (HL
block explorer for HL-side moves, Arbiscan for bridge-side).

**Mock fixture for the connected design:** one deposit (+$30,000 14D ago),
one withdrawal (–$5,000 3D ago), one deposit (+$2,500 18H ago).

**Empty:** *"No deposits or withdrawals yet. Use Deposit above to fund
your account."* — links "Deposit" to the hero's button.

**Cross-cutting for fills + transfers.** Identical row anatomy (icon ·
stacked middle · right amount), identical `.m-list` glass surface,
identical footer "View all" affordance. One row component reused with a
discriminated `kind: 'fill' \| 'transfer'` prop.

## Loading, error, empty — page-wide

Granularity = per section. No global loading screen, no global error. A
failing fills query never hides the working balance hero.

**Loading.** Each section renders skeleton rows in the same shape as its
resolved variant — no layout jump.

**Error.** Section-level inline error: small destructive-tinted text +
"Retry" link inside the card. Pattern matches the existing `.m-error`
block in `/traders/+page.svelte`. No full-screen takeover.

**Offline.** A top-of-screen banner ("Offline — values may be stale"),
driven by Capacitor's `@capacitor/network` listener (per the wrap plan).
Banner is shared chrome in `+layout.svelte`.

**Empty.** Phrased as guidance, not absence. The only "promotional" empty
state on the page is Mirror-mode-with-zero-leaders → `Pick traders to
mirror →`.

**Pull-to-refresh.** On the main scroll container, triggers parallel
refetch of all four sources with the thin `m-loading-bar` already used on
/traders.

**Stale data.** Each fetch returns `last_updated_at`; card footers show
"Updated 12s ago" in `--type-caption` tertiary so the user can tell a
quiet feed from a frozen one.

## What is NOT in this design

- Open orders. Out of scope until the product takes orders directly.
- Funding history. Could fold into Latest transactions later; not in v1.
- Performance chart on the profile page (equity curve over time as a
  visible chart). The 30D curve is fetched but only used in the hero's
  sparkline space if/when we want it.
- The `/profile/fills` and `/profile/transfers` deep routes — "View all"
  links exist on the cards but the routes themselves are a follow-up.
- Wallet provider choice / Capacitor wallet integration — separate work
  per the wrap plan.
- Mode-switch flow (the bottom sheet behind "Switch mode →" / "Edit
  allocation →") — inert links in v1.

## Open questions to resolve during implementation

- Do we ingest `userNonFundingLedgerUpdates` in the worker today? If not,
  Wallet activity ships with mock data only until that lands.
- Mock mirror book — pick 2–3 leaders from the live `/api/leaders`
  response at random for the fixture, or hardcode a static one? Random
  better demos the layout; static better demos deterministic UI states.
