# Swash — Data Sources & Freshness Architecture

**Date:** 2026-05-11
**Status:** Design agreed; pending implementation.
**Motivates:** the "last active 17 hrs" (main table) vs "latest fill 1 month ago" (trader profile) discrepancy — a symptom of components reading whichever of four uncoordinated data layers was handy.

---

## 0. The problem

Today the app's numbers come from four layers updated on different cadences, and components pick freely between them:

1. **WS-derived** — `wallets.lastSeenAt` (monotonic, from the public `trades` feed on the top-20 coins only), `wallets.totalFills` / `wallets.totalVolumeUsd` (`+= excluded.…` running accumulators — **unbounded, double-counting**). This is the "17 hrs" the main table shows.
2. **HL leaderboard snapshot** — `wallets.hlPnl7dUsd / hlRoi7d / hlVolume7dUsd / hlPnl30dUsd / hlRoi30d / hlMetricsAt` — HL's own metric definitions on HL's windows.
3. **Computed-from-ingested-fills** — `scores.*` and the `fills` / `fundings` / `ledger` tables, computed at score time from a 90-day / ≤2000-fill window; stale until the next ingest+score. The trader profile's "latest fill" = `max(fills.blockTimeMs)` = *when ingest last ran for this wallet*, not when they last traded.
4. **Live on-demand snapshot** — `leader_cache.accountValue` / `positionsJson` / `lastRefreshedAt` from `clearinghouseState` at the last "refresh" click.

The trader page even exposes `wallets.totalVolumeUsd` (layer 1) next to `scores.totalVolumeUsd` (layer 3) — two "volume" numbers on one page.

## 1. The model: two tiers, mapped onto two transports

Every displayed value belongs to exactly one of two tiers, and **every component reads the same source for the same concept**:

### Live tier — "what's true right now"
Equity, open positions, leverage/margin, **last-traded timestamp**, HL's windowed PnL/ROI (7d/30d).

- **Curated wallets** (the hook — small, tens→low-hundreds): a **persistent WS subscriber** holds per-user subscriptions — `webData2` (full clearinghouse state: equity, positions, leverage) + `userFills` + `userFundings` + `userNonFundingLedgerUpdates` — for every wallet currently in the curated set. Everything is *pushed*; no polling, no rate-limit pressure. The subscriber writes the live columns and appends streamed fills/fundings/ledger rows to the history tables, so a curated wallet's `fills` table is always current.
- **Non-curated wallets** (the long tail — thousands; can't WS-subscribe to all): live tier is filled **on demand** — when someone views the wallet (or requests a score), a REST pull (`clearinghouseState` + a `userFills` head) refreshes the live columns, cached ~15 min. No persistent subscription.

### Analyzed tier — "what the history says"
Composite score + the 8-metric breakdown, Sharpe/Sortino/PSR/profit-factor/expectancy/max-drawdown/recovery-time/monthly-consistency, total volume, total trades, win rate, equity curve, tags, decay flag.

- Computed from the **locally stored history** (`fills` / `fundings` / `ledger` + `scores`). For curated wallets that history is kept live by the WS stream; recompute on the score cadence (daily) or incrementally. For non-curated wallets the history comes from an on-demand REST backfill (`userFillsByTime` over 90d + `userFunding` + `userNonFundingLedgerUpdates`), then a score, cached 24 h.
- Carries an explicit **"as of \<timestamp\>"** — the time the history backing it was last synced.

### The transports
- **WS public `trades({coin})`** — *discovery only*. Watch the top-N coins, harvest addresses + a rough "seen trading on a watched coin" hint. It is **no longer the source of any displayed number** — once a wallet is curated we subscribe to *it* (via `userFills`) and see all its coins; for the rest, on-demand REST is the source.
- **WS per-user (`webData2` / `userFills` / `userFundings` / `userNonFundingLedgerUpdates`)** — the live tier for curated wallets, and the mechanism that keeps their history tables current.
- **REST** — four jobs only: (1) backfill a wallet's 90 d history when it enters the curated set; (2) on-demand snapshot+backfill+score for a non-curated wallet someone views/requests; (3) poll the leaderboard JSON every \~15 min (HL's ranked list → `wallets.hl*` columns + a candidate feed for curation); (4) `meta` / `perpDexs` / `spotMeta` (cached aggressively).

## 2. Canonical source per displayed concept

| Concept | Canonical source | Freshness | Notes |
|---|---|---|---|
| **Last traded** | `max(fills.blockTimeMs)` for the wallet (+ its agents) | curated: live (WS appends fills); tail: as of last on-demand sync | `wallets.lastSeenAt` is demoted to an **internal discovery signal** — never displayed |
| Account equity | `leader_cache.equity` | curated: live (`webData2`); tail: ≤15 min (REST) | rename `accountValue` → `equity` for clarity, or keep — one column either way |
| Open positions / leverage / margin | `leader_cache.positionsJson` (+ `leverage`, `marginUsed`) | same as equity | |
| HL 7d/30d PnL & ROI | `wallets.hlPnl7dUsd` etc. | ≤15 min (leaderboard poll) | HL's own definition — always labelled "Hyperliquid" so it isn't confused with our ROI |
| Composite + 8-metric breakdown | `scores.*` (+ `wallets.compositeScore`) | curated: daily; tail: as of last on-demand score (≤24 h cache) | "as of \<score time\>" shown |
| Total volume | `scores.totalVolumeUsd` | analyzed-tier freshness | the WS accumulator `wallets.totalVolumeUsd` is **retired from display** |
| Total trades | `scores.totalTrades` | analyzed-tier freshness | ~2000-fill HL cap caveat applies; `wallets.totalFills` retired from display |
| ROI (ours) | `scores.netPnlPct` (net_pnl / deposits) | analyzed-tier freshness | distinct from HL's ROI; labelled "Swash ROI" or similar |
| Equity curve | derived from `fills` (cum closedPnl−fee per day, 90d) | analyzed-tier freshness | |
| Tags / decay flag | `wallet_tags`, `scores.decayFlag` | analyzed-tier freshness | |

`wallets.totalFills` and `wallets.totalVolumeUsd` stop being `+=` accumulators — either repurposed to an honest "WS-observed in the last sweep" (set absolutely, internal only) or dropped. `wallets.lastSeenAt` keeps being maintained by the discovery feed but is internal.

## 3. New / changed schema (sketch — finalized in the plan)

- **`leader_cache`** becomes *the* live-tier table (it already half is): `equity` (numeric), `leverage` (numeric), `margin_used` (numeric), `positions_json` (jsonb), `last_trade_ms` (bigint), `source` (`'ws' | 'rest'`), `last_refreshed_at` (timestamptz). Keyed by master address. A curated wallet's row is updated by the WS subscriber; a tail wallet's row by the on-demand path.
- **`wallets`**: `last_seen_at` stays but is documented as internal-discovery-only. `total_fills` / `total_volume_usd` either become honest WS-sweep snapshots (set, not accumulated) or get dropped. (`hl*` columns unchanged — leaderboard snapshot.)
- **`curated`** flag (from the scoring-redesign plan) tells the WS subscriber which wallets to hold subscriptions for.
- (Scoring cleanup, see §5) `scores`: drop `dsr` and `calmar` columns.

## 4. Components

- **`ws-live-subscriber` (worker, long-running)** — on start and whenever the curated set changes, reconcile per-user subscriptions (`webData2` + `userFills` + `userFundings` + `userNonFundingLedgerUpdates`) for every `curated` wallet (sharding across WS connections if the count needs it). On `webData2` push → upsert the wallet's `leader_cache` live columns. On `userFills` / `userFundings` / `userNonFundingLedgerUpdates` push → append to the history tables (idempotent on tid / hash). This **replaces** `trades-subscriber` as the source of truth for curated wallets; `trades-subscriber` stays only as the discovery firehose (and stops writing the accumulator columns).
- **`leaderboard-poll` (worker, cron \~15 min)** — fetch HL's leaderboard, update `wallets.hl*`, feed new eligible wallets into the curation candidate flow.
- **on-demand path (web → worker queue)** — viewing a non-curated wallet (or the "Score this wallet" CTA) enqueues a job: REST `clearinghouseState` (→ `leader_cache` live columns), `userFillsByTime`/`userFunding`/`userNonFundingLedgerUpdates` 90 d backfill (→ history tables), then score (→ `scores`). Live columns cached ~15 min, score cached ~24 h; serve cached within TTL.
- **web queries** — `leaders.ts` (main table) and `leader-detail.ts` (profile) both read live-tier values from `leader_cache` and analyzed-tier values from `scores` — never `wallets.lastSeenAt` / `wallets.totalFills` / `wallets.totalVolumeUsd` for display. Each card/page shows the two "as of" stamps (live, analyzed).
- **`scores.ts` (worker)** — when it recomputes a curated wallet, it also reads the now-fresh `fills` (kept current by the WS subscriber) — so the analyzed tier is current too.

## 5. Scoring cleanup folded in (decided 2026-05-11)

- **Drop DSR entirely** — calibration over 235 real wallets: with 214 trials the deflated benchmark (~2.4 in daily-Sharpe units) sits above every wallet's daily Sharpe (max 1.28), so DSR ≈ 0 for the whole population and can't discriminate. Remove `dsr.ts`, `dsr` from `MetricKey` / `METRIC_CURVES` / `BASKET` / `index.ts` exports / `scores` table / `leader-detail.ts` / the calibration script / the methodology copy. (`adjustedBenchmarkSharpe` / `standardNormalInverseCdf` in `psr.ts` become unused — remove or leave dormant; `psr.ts`'s own `probabilisticSharpe` stays.)
- **Drop Calmar entirely** — calibration: p99 ≈ 1e140, max ≈ 1e179 (the `(1+r)^(365/n)` annualization explodes on short hot histories). Remove `calmar` from `metrics.ts` + its tests, from `MetricKey` / `METRIC_CURVES` / `BASKET`, from `scores` table / `leader-detail.ts` / the calibration script / the methodology copy.
- Basket is now **8 metrics**: Sharpe, Sortino, PSR, profit factor, expectancy, max drawdown, recovery time, monthly consistency. Even count → median of the two middle values (already handled).
- **Confidence cap is on the wrong field** — `medianComposite` multiplies by `min(activeDays/90, 1)`, but `activeDays` (days with ≥1 fill, real-data p50 ≈ 57/90) penalizes intermittent-but-long-tenured traders. Switch the cap input to **calendar span `daysOfData`** (first→last event in days; real-data p50 ≈ 86/90) — passed in from the worker — so it penalizes *short total history*, which is what it's for.
- **Open: expectancy is raw USD** (real-data range −1719…+1418, median ≈ 0) — meaningless without normalizing by trade/account size. Proposal: replace with a per-trade *return* expectancy (or expectancy ÷ median trade notional). Decide during implementation; if no clean fix, it's a candidate to drop too (basket → 7).
- The provisional curves in `curves.ts` get re-fit from the calibration CSV (`/tmp/curves-calib.csv`, 235 wallets) over the *remaining* metrics, with heavy-tailed ones (Sortino daily — p99 ≈ 753; profit factor — p99 ≈ 1678) clamped at ~p90.

## 6. Out of scope / deferred

- The strong discovery tool (deferred from the scoring-redesign plan) — `trades-subscriber` stays as the v1 firehose.
- Multi-region / sharded WS scale-out beyond what the curated-set size needs.
- `portfolio(user)` endpoint (HL's equity/PnL time-series) — nice-to-have for a richer equity curve; not v1.
- The UI changes themselves (the user is handling `apps/web` rendering); this design fixes the *data layer and the queries*, and provides the field/source contract the UI consumes.
