# Trader page real-time — design

Date: 2026-05-16

## Goal

The `/trader/[address]` page should reflect a trader's open positions and recent fills without requiring a manual page refresh, with snappy (5–10s) freshness for any wallet the user lands on.

## What's already in place

- `+page.server.ts` calls `getLeaderDetail(address)` once at page load.
- `leader-detail.ts` reads `open_positions` from `leader_cache.positions_json` and `recent_fills` from `fills` (top-N by `block_time_ms`).
- Backend ingestion freshness per cohort:
  - **Curated** (~235 wallets): sub-second via `ws-live-subscriber`.
  - **Top-250 tracked**: 60s via `leader-cache-poll`.
  - **Outside top-250** (~4,000+ listable): no live source — frozen until manual ingest.

The page itself does no polling and serves a point-in-time snapshot.

## Decisions

- **Freshness budget**: snappy (5–10s polling).
- **Coverage for non-cohort wallets**: on-demand HL refresh at page open. Subsequent polls return whatever the backend has — for non-cohort wallets that's the same first-paint snapshot, accepted as a trade-off.
- **Transport**: HTTP polling. No SSE/WebSocket in v1.
- **Scope**: just the trader detail page. Leaderboard `/`, score, equity curves, etc. stay batch-driven.

## Design

### 1. Server-side ensure-fresh

In `apps/web/src/routes/trader/[address]/+page.server.ts`, before rendering:

- Read a tiny query for `leader_cache.last_refreshed_at`.
- If the row is missing OR older than 30s, kick off `ensureFresh(address)` (a one-shot HL `clearinghouseState` + `userFills` pull, reusing the worker's `ingestWallet` service).
- Run that pull in parallel with the existing `getLeaderDetail` query so DB latency overlaps with HL latency.
- After both settle, re-read just the live slice if we triggered a refresh, so the page paints the post-pull data.

Backed by a module-level `Map<address, Promise>` so N concurrent viewers share one HL call, and a `Map<address, lastRefreshMs>` cooldown so page-reload spam doesn't hammer HL (min 30s between forced refreshes per address).

Cost: an extra ~300–800ms TTFB for stale/non-cohort addresses. Cohort wallets that already have a fresh `leader_cache` row pay nothing extra.

### 2. New live JSON endpoint

`apps/web/src/routes/trader/[address]/live/+server.ts` — a GET endpoint returning the volatile slice of the leader payload:

```ts
{ open_positions, recent_fills, live_refreshed_at, live_source }
```

Pure DB read via `getLiveSlice(address)`, no HL call. Target ~5–10ms.

`getLiveSlice` is extracted from the existing `getLeaderDetail` logic so the loader and the endpoint share exactly one query — preserves the project's "one source of truth per data point" rule.

### 3. Client poll loop

In `apps/web/src/routes/trader/[address]/+page.svelte`:

- Replace static destructuring of `open_positions`/`recent_fills`/`live_refreshed_at`/`live_source` with `$state` runes seeded from `data.leader`.
- `setTimeout`-chained poll every **8s** (split between 5 and 10) while `document.visibilityState === 'visible'`.
- On `visibilitychange` → `visible`: fire an immediate poll, then resume the chain.
- On fetch failure: keep last good state, log to console, skip the tick.

Why `setTimeout` chain over `setInterval`: queues drift gracefully on slow fetches and prevents overlapping in-flight requests.

The score card, profile chips, 90d equity curve, etc. stay rendered from the initial loader payload — they're computed nightly, not from ingestion, so re-polling them is wasted work.

## Surfaces touched

| File | Change |
|---|---|
| `apps/web/src/lib/server/queries/leader-detail.ts` | Extract `getLiveSlice(address)` from existing positions + recent-fills logic |
| `apps/web/src/lib/server/ensure-fresh.ts` | **New** — in-flight map, 30s cooldown, calls into worker's `ingestWallet` |
| `apps/web/src/routes/trader/[address]/+page.server.ts` | Add stale check + parallel `ensureFresh` call |
| `apps/web/src/routes/trader/[address]/live/+server.ts` | **New** — JSON endpoint serving `getLiveSlice` |
| `apps/web/src/routes/trader/[address]/+page.svelte` | Reactive state + visibility-aware poll loop |

## Out of scope

- Push transport (SSE / WebSocket → browser). Revisit if 8s feels laggy.
- Pinning viewed addresses into `leader-cache-poll`'s backend cohort. Would give continuous freshness for non-cohort viewers; bigger architectural change.
- Row-flash / "new fill" highlight animation.
- Live updates on the leaderboard `/` page.
- Live re-computation of score / win_rate. Those stay nightly-batch.

## Edge cases

- **HL 429 during ensureFresh**: catch & log, page renders DB state.
- **Concurrent viewers of one trader**: shared in-flight promise → one HL call.
- **Page-reload abuse**: 30s cooldown per address.
- **Hidden tab**: poll suspends, doesn't wake server for invisible viewers.
- **Network failure on poll**: keep last good state, retry next interval.
