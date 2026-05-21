# Mobile home screen — design

Date: 2026-05-21 · Status: validated design, executing

A new landing screen at `/` for `apps/mobile` that aggregates three discovery
surfaces: top traders (windowed), featured private-company markets, and a
volume-ranked assets mini-table with category filters. Reached by tapping the
Swash logo; bottom nav (Assets / Traders / Feed) is unchanged and the full
list screens remain the tab destinations.

## Decisions (locked with the user)

- **Route/nav:** `/` becomes the home (remove the 308 redirect to `/traders`),
  reached via the header logo. Connect Wallet is removed from the header.
- **Top-traders timeframe:** build the real windowed backend now (1d / 7d / 1m).
- **Top-traders layout:** horizontal-scroll card strip.
- **Featured companies:** OpenAI (`vntl:OPENAI`), Anthropic (`vntl:ANTHROPIC`),
  SpaceX (`xyz:SPCX`) — narrower cards, price + 24h change.
- **Assets:** top-25 by 24h volume, row view, no volume column. Horizontally
  scrollable filter row: ☆ favorites (stub), Stock, Crypto, Commodity, Index.

## Backend — windowed top traders

HL's leaderboard poll already fetches `day` / `week` / `month` / `allTime`
buckets per wallet but only persists week + month. So:

1. **Schema (migration 0006):** add `hl_pnl_1d_usd`, `hl_roi_1d`,
   `hl_volume_1d_usd` to `wallets`. Additive, safe; `pnpm db:generate` then
   `db:migrate`. (Approved write to live Neon DB.)
2. **Poll job** (`apps/worker/.../leaderboard-poll.ts`): persist `r.day.*` into
   the new columns alongside the existing 7d/30d writes. 1d backfills on the
   next poll cycle after deploy.
3. **Query** (`apps/web/.../queries/weekly-leaders.ts` or a new
   `top-traders.ts`): `listTopTradersByWindow(window: '1d'|'7d'|'30d', limit)`
   ordering by the matching `hlPnl*` column, `NOT NULL`, constrained to
   `tracked_wallets` (recommendation surface). Metric = HL-reported realized
   PnL over the window — consistent with the Winners / Monthly strips.
4. **Endpoint:** `GET /api/leaders/top?window=1d|7d|30d&limit=10` →
   `{ ok, data: { traders: [...] } }`. Reuses the `LeaderCard`-style shape,
   narrowed.

## Frontend — `apps/mobile`

- **Route:** delete the `+page.server.ts` redirect; `/` renders the home (pure
  client load, `prerender = false`). Logo already links to `/`.
- **Header** (`+layout.svelte`): remove the Connect Wallet button.
- **Section 1 — Top Traders:** header + right-aligned `[1d][7d][1m]` segmented
  control (squarish, border+text selection, default 7d). Horizontal-scroll
  strip of glass trader cards (avatar, short address, tag, window PnL + ROI).
  Tap → `/trader/[address]`. New API client `leaders-top.ts`.
- **Section 2 — Featured companies:** three narrower glass cards from
  `/api/assets` (filtered to the hardcoded coin list). Logo, name, price, 24h
  change. Tap → `/assets/[coin]`. A card self-hides if its coin is absent.
- **Section 3 — Assets:** top-25 by `volume24h` from `/api/assets`, reusing
  `MobileAssetRow` (no volume shown — already optional). Horizontally
  scrollable filter row (☆ stub + 4 categories), squarish border+text
  selection. "See all" → `/assets`.
- **Categories:** extend `coinCategory()` (mobile + web `coin.ts`) to a 4-way
  `crypto | stocks | commodity | index`, carving commodities (GOLD, SILVER,
  COPPER, NATGAS, CL/BRENTOIL, PLATINUM, PALLADIUM, WHEAT, …) out of `stocks`.
- **Favorites:** ☆ filter renders but is inert this pass (no persistence) —
  wired later.

## Verification

`pnpm check` (mobile + web); screenshot `/` at 390×844 mobile emulation;
confirm timeframe switching, company cards render with live prices, category
filters subset the table.

## Out of scope

- Favorites persistence (localStorage / account).
- Capacitor wrap (next phase).
