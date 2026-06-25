# EP Single-Roster — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Extremely Profitable Hyperdash cohort the single wallet roster behind asset pages and trader list/detail, drop copy-trade, and delete the old DB ingest/scoring pipeline.

**Architecture:** A shared request-time module `apps/api/src/lib/server/ep/` owns the EP roster and its Hyperdash-derived outputs (positions, trades, sentiment, per-trader detail). Asset pages + trader list/detail read it; the old `fills`/`scores`/`leader_cache` queries are deleted and their tables dropped. Mobile is a pure `/api` client, so it only changes endpoint shapes + copy-trade UI.

**Tech Stack:** SvelteKit (apps/api BFF, apps/mobile client), Drizzle + Neon Postgres, Hyperdash public GraphQL, HL `candleSnapshot` for charts, pnpm workspace.

**Worktree:** `/Users/ege/swash/.worktrees/ep-single-roster` (branch `ep-single-roster`, deps installed).

**Verification model:** No test framework in this repo. "Verify" = `pnpm check` (worktree root) passes for touched packages + targeted `curl` of changed endpoints against a local `apps/api` (`DB_OVER_WS=1 pnpm --filter @copytrade/api dev`, port 5174). Commit after each task.

---

## Resolved decisions (locked 2026-06-25)

- **MVP on Hyperdash data directly** (HL-native deferred → `2026-06-25-hyperdash-independence-migration.md`).
- **Feed is the USER's parallel track** — this plan does NOT edit `apps/mobile/src/routes/feed/**`, `apps/mobile/src/lib/api/feed.ts`, or `MobileTicker.svelte`. It only ensures `ep/` can power them. The existing `queries/hyperdash-{positions,trades}.ts` + `cohort-sentiment.ts` become **thin re-exports** of `ep/` so the feed keeps compiling.
- **Live streams dropped** — delete `/api/stream/trades` + `/api/stream/trader/[address]`; keep `/api/stream/prices` (HL). Surfaces poll instead.
- **Delete all peripheral endpoints** — `/api/stats`, `/api/refer`, `/api/trader/[address]/deepen`, `/api/leaders/[address]/refresh`, weekly-leaders "top earners".
- **Trader detail = option (a)** — Hyperdash-flavored (positions + recent trades + basic stats), no Swash score. Full restructure is a separate "new product" track.
- **Asset "Top trades" = largest by notional** (flippable to closed-PnL later).

### Merge note (parallel feed work)
The user has uncommitted feed edits on `mobile-trader-card-tweaks` (incl. deleting `queries/hyperdash-trades.ts`). This branch keeps `ep/trades.ts` (needed by asset + trader detail) and re-export shims. Expect a small merge reconciliation on the feed files; resolve in favor of the user's feed edits, keep `ep/` as the data source.

---

## Phase A — EP module foundation (non-destructive)

### Task A1: shared Hyperdash client
**Files:** Create `apps/api/src/lib/server/ep/shared.ts`

Consolidate the duplicated transport from the 4 existing query files:
```ts
export const HYPERDASH_GRAPHQL = 'https://api.hyperdash.com/graphql';
// Browser UA + origin required — Hyperdash blocks default agents.
export const HD_HEADERS = { 'content-type': 'application/json', origin: 'https://hyperdash.com',
  referer: 'https://hyperdash.com/', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' };

/** POST a Hyperdash GraphQL op; returns data or throws. */
export async function hdFetch<T>(operationName: string, query: string, variables?: unknown): Promise<T> { /* fetch + ok check + errors check + return json.data */ }

/** Tiny TTL cache with last-good fallback (the pattern duplicated across the 4 files). */
export function ttlCache<T>(ttlMs: number) { /* returns { get(): T|null, set(v), stale }; serve-last-good handled by caller */ }
```
**Step — verify:** `pnpm --filter @copytrade/api check` passes (file unused yet is fine).
**Commit:** `feat(ep): shared Hyperdash client + ttl cache`

### Task A2: roster
**Files:** Create `apps/api/src/lib/server/ep/roster.ts` (move logic from `queries/hyperdash-ep-traders.ts:17-73`).
Export `EpTrader` + `getEpRoster(): Promise<EpTrader[]>` (was `getExtremelyProfitableTraders`, `ExploreTraders` op, top ~80 by all-time PnL, 10-min TTL via `ttlCache`). Keep `pnlCohort` so we can assert EP. Roster size const `ROSTER_SIZE = 80`.
**Verify:** `pnpm --filter @copytrade/api check`. **Commit:** `feat(ep): roster`

### Task A3: positions + trades (with by-coin slices)
**Files:** Create `apps/api/src/lib/server/ep/positions.ts` and `ep/trades.ts` (move from `queries/hyperdash-positions.ts` + `queries/hyperdash-trades.ts`, using `ep/roster` + `ep/shared`).
- `positions.ts`: `getEpPositions(): Promise<MarketPositions[]>` (feed) **and** `getEpPositionsForCoin(coin): Promise<MarketPositions | null>` (asset page) — both derived from one cached roster fan-out (don't double-fetch; cache the flat `SmartPosition[]`, slice per consumer).
- `trades.ts`: `getEpTrades(): Promise<SmartTrade[]>` (feed) **and** `getEpTradesForCoin(coin, limit): Promise<SmartTrade[]>` (asset latest/top). Cache the flat trade list once; slice by coin.
**Verify:** check passes. **Commit:** `feat(ep): positions + trades with by-coin slices`

### Task A4: sentiment
**Files:** Create `apps/api/src/lib/server/ep/sentiment.ts` (move from `queries/cohort-sentiment.ts:1-249`, keep `biasFor` exported, keep all `Cohort*`/`MarketSentiment` types).
**Verify:** check. **Commit:** `feat(ep): sentiment`

### Task A5: per-trader detail (NEW — powers the trader page)
**Files:** Create `apps/api/src/lib/server/ep/trader.ts`
`getEpTraderDetail(address): Promise<EpTraderDetail | null>` returning:
- open positions (`traderPerpPositionsTooltip`, same op as positions.ts),
- recent completed trades (`getTraderCompletedTrades`, same op as trades.ts, larger pageSize),
- basic stats from the roster row if present (pnl, winrate, topAssets) else a per-address `exploreTraders`/trader lookup.
No Swash score. Shape designed for the mobile trader page (see Phase C/D).
**Verify:** check + `curl` once wired (Phase C). **Commit:** `feat(ep): per-trader detail`

### Task A6: re-export shims (keep feed compiling)
**Files:** Modify `queries/hyperdash-positions.ts`, `queries/cohort-sentiment.ts` to re-export from `ep/` (e.g. `export { getEpPositions as getHyperdashPositions, type MarketPositions } from '../ep/positions';`). Leave `queries/hyperdash-trades.ts` as-is (user may delete it on their branch).
**Verify:** `pnpm --filter @copytrade/api check` + curl `/api/feed/hyperdash-positions`, `/api/feed/cohort-sentiment` still return the same shape. **Commit:** `refactor(feed): point existing hyperdash queries at ep module`

---

## Phase B — Asset pages on EP

### Task B1: EP-backed asset top-traders + latest-trades
**Files:** Modify `apps/api/src/lib/server/queries/asset-detail.ts`
- KEEP `getCandles()` (HL `candleSnapshot`, lines ~70-100) untouched.
- REPLACE `getAssetTopTraders` (fills, ~88-110), `getOpenPositionsOnAsset` (leaderCache, ~177-210), `getLatestOpensOnAsset`/`getTraderOpensInRange` (fills) with EP versions:
  - top-traders for coin = `getEpTradesForCoin(coin)` aggregated by address → rank by summed notional (default) ; include displayName, side, netPnl.
  - latest-trades for coin = `getEpTradesForCoin(coin, limit)` newest first.
  - open positions for coin = `getEpPositionsForCoin(coin)`.
- Drop the `fills` import.
**Verify:** check + curl `/api/assets/BTC/top-traders?limit=5`, `/api/assets/BTC/latest-trades?limit=10`, `/api/assets/BTC/candles?range=1d`. **Commit:** `feat(asset): top/latest trades from EP cohort`

### Task B2: delete fills-based best-asset (if unused)
**Files:** Grep `best-asset` consumers. If none in mobile, delete `queries/best-asset.ts` + any route. Else port to EP.
**Verify:** check. **Commit:** `chore(asset): remove fills-based best-asset`

---

## Phase C — Trader list + detail on EP

### Task C1: trader list from the roster
**Files:** Create `queries/ep-leaders.ts`; modify routes `routes/api/leaders/+server.ts`, `routes/api/leaders/top/+server.ts` (+ `/api/leaders-top` alias if present).
List = `getEpRoster()` mapped to the card shape mobile expects (address, displayName, pnlUsd, winrate, topAssets; **no score/copyScore**). `top?window=` → for MVP ignore window (EP is all-time) or sort by pnl; document the simplification.
**Verify:** check + curl `/api/leaders`, `/api/leaders/top?window=7d`. **Commit:** `feat(leaders): list from EP roster`

### Task C2: trader detail from EP, drop SSE
**Files:** modify `routes/api/leaders/[address]/+server.ts` → `getEpTraderDetail`. DELETE `routes/api/stream/trader/[address]/` and `routes/trader/[address]/live/+server.ts`. Delete `queries/leader-detail.ts`.
**Verify:** check + curl `/api/leaders/0x…`. **Commit:** `feat(trader): detail from EP, remove live SSE`

---

## Phase D — Strip copy-trade UI (mobile, non-feed)

**Files (from exploration; SKIP feed files — user's track):**
- `routes/trader/[address]/+page.svelte` — remove Mirror FAB (~244-252) + `.m-mirror-fab` CSS (~378-386); swap score block for Hyperdash stats from the new detail payload.
- `lib/components/MobileTraderCard.svelte` — remove Mirror button (~131-137) + `.m-trader-mirror` CSS; drop score, show pnl/winrate.
- `lib/components/MobileAppSheets.svelte` (~37-56) + `lib/ui/sheets.svelte.ts` (remove `'mirror'` from union).
- `routes/+layout.svelte` (~53 tagline), `routes/methodology/+page.svelte` (copy-trader wording), `routes/profile/+page.svelte` ("Your mirrors" mock).
**Verify:** `pnpm --filter @copytrade/mobile check` (note: pre-existing `avatars/+page.svelte` esm.sh errors are unrelated). **Commit per file group.**

---

## Phase E — Remove dead code (after surfaces repointed)

### Task E1: worker
Delete jobs: `bootstrap, fills-retention, hyperdash-ingest, leaderboard-ingest, leaderboard-poll, leader-cache-poll, refresh-queue, score, trades-coin-subscriber, trades-subscriber, ws-live-subscriber, hip3-poll-subscriber`; `services/ingest-wallet.ts`; `lib/gate-reconcile.ts`; `lib/hyperdash.ts`; all `src/scripts/*`. Trim `index.ts` + `cli.ts` to **cohort-snapshot only**. Update `apps/worker/package.json` scripts + drop `@copytrade/scoring` dep. Update root `package.json` worker shortcuts + `ecosystem.config.cjs` (remove leader-cache-poll/ws-live/trades-coin-live/hip3-poll-live PM2 entries; worker-cron comment → cohort-snapshot only).
**Verify:** `pnpm --filter @copytrade/worker check`. **Commit:** `chore(worker): remove ingest/scoring pipeline`

### Task E2: packages/scoring + db code
Delete `packages/scoring/` entirely; remove `@copytrade/scoring` from any package.json (worker/api/mobile). Delete `packages/db/src/leader-cache-merge.ts` + its export in `packages/db/src/index.ts:2`. In `packages/db/src/schema.ts` delete tables wallets/fills/fundings/ledger_updates/scores/wallet_tags/leader_cache/discovery_queue/audit_log + their type exports (KEEP `cohortSentimentHistory`). Delete `packages/db/sql/*` (leaders view + 1d-window).
**Verify:** `pnpm --filter @copytrade/db check` + `pnpm --filter @copytrade/api check` (will fail until E3). **Commit:** `chore(db): drop dead schema + scoring package`

### Task E3: dead API queries/routes
Delete `queries/{leaders,leader-detail,weekly-leaders,analytics,holdings,best-asset}.ts` and routes `api/stats`, `api/refer`, `api/trader/[address]/deepen`, `api/leaders/[address]/refresh`, `api/stream/trades`, and any feed routes still bound to `analytics.ts` that the user's feed no longer needs (coordinate: `most-held`, `top-open-positions`, `latest-trades` — confirm with user before deleting, since feed is their track).
**Verify:** `pnpm --filter @copytrade/api check` clean; grep `apps/api/src` for `fills|scores|leader_cache|tracked_wallets|wallets\b` → no stale refs. **Commit:** `chore(api): remove DB-pipeline queries + peripheral routes`

---

## Phase F — DB migration (LAST; explicit go before applying to live)

### Task F1: drop migration
**Files:** Create `packages/db/migrations/0011_drop_pipeline_tables.sql` + add `_journal.json` entry (idx 11, `when` 1779030000005). Hand-authored (db:generate broken — snapshots stop at 0005).
```sql
DROP VIEW IF EXISTS "leaders";
DROP VIEW IF EXISTS "tracked_wallets";
DROP TABLE IF EXISTS "audit_log";
DROP TABLE IF EXISTS "discovery_queue";
DROP TABLE IF EXISTS "leader_cache";
DROP TABLE IF EXISTS "wallet_tags";
DROP TABLE IF EXISTS "scores";
DROP TABLE IF EXISTS "ledger_updates";
DROP TABLE IF EXISTS "fundings";
DROP TABLE IF EXISTS "fills";
DROP TABLE IF EXISTS "wallets";
```
**Verify (worktree, NOT live yet):** review SQL.
**Apply to live (REQUIRES EXPLICIT USER GO):** `DB_OVER_WS=1 pnpm --filter @copytrade/db migrate`; confirm via Neon that only `cohort_sentiment_history` (+ drizzle migration table) remain; check reclaimed size.
**Commit:** `feat(db): drop dead pipeline tables + views (reclaims ~364MB fills)`

---

## Phase G — Final verification
- `pnpm check` + `pnpm build` at worktree root (mobile `avatars` esm.sh errors pre-exist).
- Grep `apps/api/src` + `packages/` for every dropped name (table, column, `@copytrade/scoring`) → zero stale refs (STRICT RULE).
- Curl smoke: `/api/leaders`, `/api/leaders/0x…`, `/api/assets/BTC/{top-traders,latest-trades,candles}`, `/api/feed/{hyperdash-positions,cohort-sentiment}`.
- `superpowers:finishing-a-development-branch` to land it.

## Out of scope (separate tracks)
- Feed data wiring (user's parallel track).
- Trader-page full restructure ("new product").
- Sentiment-data product (built on `cohort_sentiment_history`).
- HL-native data pipeline (`2026-06-25-hyperdash-independence-migration.md`).
