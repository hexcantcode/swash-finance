# Idea — Analytics page (third top-nav surface)

**Date raised:** 2026-05-13
**Status:** Parked. Surface design only; not built.

User wants a third top-nav surface after **Traders** and **Assets**, called **Analytics**. Three stacked panels:

1. **Latest trades** — 10-row table (top of page). Most-recent fills across the tracked-wallet set, newest first. Trader · coin · side · size · time-ago. Same data we already have in `fills` + `recent_fills_json` on `leader_cache`; pick whichever is freshest. Auto-refresh / WS push.

2. **Position matrix** — *the* showcase widget. Pattern in `kismet`: see `/Users/ege/kismet/apps/web/src/routes/analytics/+page.svelte` (≈669 LOC) + `/Users/ege/kismet/apps/web/src/lib/server/analytics.ts` (`liveFlow` / `refresh` are the API surface). The matrix is **top-25 tracked wallets across the rows × current asset universe across the columns** with a coloured cell for every (wallet, coin) where the wallet currently holds a position — green for long, red for short, tint intensity scales with notional. Empty cell = wallet doesn't hold that coin. Sidebar filters (size buckets, coin class, long-only / short-only). It's the at-a-glance "who's positioned where" picture.

3. **Top 25 positions by PnL** — table at the bottom. All currently-open positions across all tracked wallets, sorted by `unrealized_pnl` desc, top 25. Columns: trader · coin · side · entry · current · unrealized PnL · ROE. Same shape as the existing `/assets/[coin]` "Open positions" panel, just globally instead of per-coin.

## Inputs (already in our DB)

- `leader_cache.positions_json` — every position for every tracked wallet, refreshed live for winners (and stale-snapshot for the rest). Same JSON we already unpack in `getOpenPositionsOnAsset` — generalize that query to drop the `coin` filter.
- `fills` table — for the latest-trades feed. Pull last 10 ordered by `block_time_ms desc` over the tracked-wallet set.
- The asset universe + current mark prices come from `metaAndAssetCtxs` (`apps/web/src/lib/server/queries/assets.ts`) — we already fetch this on the assets page.

## Implementation outline

1. **`apps/web/src/routes/analytics/+page.server.ts`** — load three things in parallel:
   - `getLatestFills(10)` — global most-recent fills.
   - `getPositionMatrix({ tradersLimit: 25, coinUniverse })` — cross-product of (wallet × coin), with `{ szi, notional, side, unrealizedPnl }` per holding cell. Most cells empty.
   - `getTopOpenPositionsByPnl(25)` — global top-25 positions by `unrealized_pnl` desc.

2. **`apps/web/src/routes/analytics/+page.svelte`** — three sections, same `.k-mini-table` / `.stripe-table` style we use elsewhere. Reuse the live-price WS already added on `/assets/[coin]` for the unrealized PnL recompute on the third panel.

3. **Nav** — `apps/web/src/routes/+layout.svelte`: append `Analytics → /analytics` next to `Traders` / `Assets`.

## kismet reference (for the matrix)

- `/Users/ege/kismet/apps/web/src/routes/analytics/+page.svelte` — full page including the matrix grid, hover detail, sentiment gauge.
- `/Users/ege/kismet/apps/web/src/lib/server/analytics.ts` — `LiveFlowRow` / `LiveFlowResult` types, `liveFlow()` query, `refresh()` job. We don't need their venue-switcher abstraction (HL only here).
- Their `+page.svelte:152` `matrixView` derive shape is the right one to copy: a `Map<traderAddr|assetKey|side, cell>` so each grid cell is an O(1) lookup.

## Open questions for the implementation session

- **Coin universe in the matrix:** all ~180 HL perps is too wide for a screen. Probably the top-N coins by tracked-wallet *holdings* — say the coins where ≥3 of our 25 traders have a position. Calibrate during build.
- **Refresh cadence:** the matrix and top-pnl table both read `leader_cache`, which the worker keeps fresh for the winner set only. After [[real-time-tracked-wallets-plan]] lands (= all 250 tracked via WS), the analytics page becomes truly live.
- **Polymarket inclusion:** kismet's analytics handles both HL + Polymarket. We're HL-only for Swash today. Skip the venue switcher.
