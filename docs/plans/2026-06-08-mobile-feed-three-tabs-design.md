# Mobile feed — three tabs (Trades · Positions · Sentiment)

Date: 2026-06-08 · Branch: `mobile-trader-card-tweaks`

## Goal

Rebuild the mobile `/feed` page into three tabs over the tracked-wallet
cohort:

1. **Trades** — latest aggregated fills (existing behaviour, unchanged).
2. **Positions** — open positions enriched with PnL, ROI, leverage, and
   liquidation level.
3. **Sentiment** — per-asset long/short split ("6 longs / 3 shorts") with
   a dollar-weighted green/red bar, split Stock&Commodity / Crypto.

**Dropped during build:**
- *Stop-loss* — lives in HL `frontendOpenOrders` (trigger orders), which we
  don't poll or store. Adding it would mean a new HL client method + worker
  job + `orders_json` column — out of scope.
- *Open time* — only ~10% of the surfaced (winner) positions have a recorded
  opening fill (`start_position = 0`); the rest opened before our ~2-day fill
  window. Too sparse to be useful here, so dropped rather than shown blank.
- *Cross/isolated margin tag* — dropped to keep the row compact.

Everything remaining is already in `positions_json` + `fills`, so the change
is **web-query + mobile-UI only** (no DB / worker / hl-client changes).

## Data sources (all existing)

- `leader_cache.positions_json` — HL `clearinghouseState.assetPositions`.
  Each position has `szi, coin, entryPx, leverage{type,value}, marginUsed,
  maxLeverage, liquidationPx, positionValue, unrealizedPnl, returnOnEquity`.

Cohort note: the poller (`leader-cache-poll`) refreshes the
`tracked_wallets` view; `leader_cache` itself holds more wallets (WS writer +
history). Positions/sentiment unpack all of `leader_cache`.

## Backend (web)

### `getTopOpenPositions` (analytics.ts) — extend, single source of truth

Add `liquidationPx` to the SQL select and `liquidationPxUsd: number | null`
to `TopOpenPosition`. `returnOnEquity` and `leverage` are already present.
`getTopOpenPositionsByCategory` inherits the new field automatically (it
calls `getTopOpenPositions`). The mobile Positions tab keeps consuming
`/api/feed/top-open-positions`.

### Sentiment endpoint — new, thin

`GET /api/feed/most-held` → `getMostHeldByCategory({ perCategory: 8 })`.
Returns `{ ok, mostHeld: { stocks: MostHeldRow[], crypto: MostHeldRow[] } }`.
`MostHeldRow` already has `coin, holders, longCount, shortCount,
netNotionalUsd`. For the dollar-weighted bar the row also needs long vs
short **notional** — extend `MostHeldRow` / `getMostHeldByCategory` to emit
`longNotionalUsd` / `shortNotionalUsd` (it already sums them internally as
`netNotional`; split the accumulator).

## Mobile

### `$lib/api/feed.ts`
- Extend `TopOpenPosition` with `liquidationPxUsd`.
- Add `MostHeldRow`, `CategorizedMostHeld`, `getMostHeld()`.

### `feed/+page.svelte`
- Tabs: `trades | positions | sentiment`.
- Positions row: existing chrome + ROI (under PnL, right column), `Nx`
  leverage on line 2, `Liq $…` on line 3.
- Sentiment: two sections (Stock&Commodity, Crypto). Each row = coin icon +
  name, "N longs / M shorts" (green/red counts), and a horizontal bar split
  green(long $)/red(short $) by notional, with net $ labelled.
- Poll cadence unchanged (10s). Add `getMostHeld()` to the parallel load.

## Verify
- `pnpm check` + `pnpm build` pass.
- `curl /api/feed/most-held` and `/api/feed/top-open-positions` return 200
  with the new fields.
- Grep confirms no consumer reads a renamed/removed field.
- Visually confirm the three tabs on the running mobile dev server (:5173).
