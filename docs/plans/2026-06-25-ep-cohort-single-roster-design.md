# EP cohort as the single roster — sentiment-first pivot (drop copy-trade)

**Status:** Design approved 2026-06-25. Ready for an implementation plan.

## Decision

Swash drops copy-trading of active traders and pivots to a **sentiment-first**
product. The **Extremely Profitable cohort** (Hyperdash's +$1M+ all-time PnL
tier — the "smart money") becomes the **one roster to rule them all**: the only
set of wallets the app cares about. Every roster surface is driven by it.

- **MVP runs on Hyperdash data directly.** Swapping to our own Hyperliquid-native
  pipeline is deferred to `2026-06-25-hyperdash-independence-migration.md`
  (Hyperdash's per-trade *prices* are known-corrupt; that's the reason the
  native swap exists, and why asset "top trades" by price come with that caveat).
- **The old DB pipeline is removed outright** — no two-phase repoint. We delete
  the scoring pipeline and the historical wallet/fills data now.

## Architecture — the live EP module

One shared module owns "who are the EP traders, and what are they doing." Every
surface reads from it; nothing fetches the roster on its own.

- **Location:** `apps/api/src/lib/server/ep/` — a request-time service with
  in-memory caches. **No new DB tables** (keeps us under the capacity cap until
  the upgrade).
- **"Constantly updates" = TTL refresh:** roster on a ~10 min TTL; derived
  outputs (positions/trades) on ~60 s. Matches the existing feed pattern, just
  unified. Chosen over a pre-warming worker for MVP simplicity; promotable later
  if cold-cache latency hurts.
- **Shape:**
  - `roster.ts` — the single definition of the EP roster, via Hyperdash
    `exploreTraders(timeframe: all, sortBy: pnl desc)`. Roster size (~80–100) is
    the one knob trading coverage against per-trader fan-out call volume.
  - `positions.ts` / `trades.ts` — fan out the roster's positions + recent trades
    **once** (cached); all surfaces slice this shared data.
  - `sentiment.ts` — the cohort aggregate (`perpsMarketParticipation`), unchanged.

## Surfaces & data flow

The roster's positions + trades are fanned out once and **sliced** per surface —
asset pages make no new Hyperdash calls.

- **Trader list** = the EP roster.
- **Feed → latest trades** = all roster trades, newest first.
- **Feed → positions** = roster positions grouped by coin → top markets.
- **Feed → vibe/sentiment bars** = cohort aggregate (the `cohort-snapshot`
  recorder keeps writing history to DB; that table stays — it's data only).
- **Asset page (coin X)** = the same cached roster data filtered to X.
  - *Latest trades* = most recent in X.
  - *Top trades* = **largest by notional** (flippable to closed-PnL later).
- **Trader page (on tap)** = lightweight, Hyperdash-flavored (option a): the
  wallet's open positions, recent trades, top assets, Hyperdash stats. No Swash
  score, no copy framing. Hydrate from the roster + a per-address detail call.

```
Hyperdash ─┬─ roster.ts ──> fan-out positions+trades (cached)
           │                    ├─> trader list (the roster)
           │                    ├─> feed: positions / latest trades
           │                    └─> asset page: slice by coin
           ├─ cohort-sentiment (live) ──> feed vibe bars
           └─ trader page (per-address, on tap)

cohort-snapshot worker ──> DB cohort_sentiment_history (data only)
```

**Errors:** serve last-good cache on upstream blips (existing pattern); empty →
UI hides the section; roster fetch failure → keep the previous roster.

## Removal — dead pipeline & old data (do now)

Nothing below is load-bearing once surfaces read the EP module. Remove it,
tracing each consumer per the STRICT RULE (grep before claiming done).

- **`packages/scoring`** — the whole scorer.
- **Worker jobs / crons:** `bootstrap`, `leaderboard`, `leaderboard-poll`,
  `hyperdash` (copytraders ingest), `trades-watch`, `trades-coin-live`,
  `hip3-poll-live`, `fills-retention`, `ws-live`, `leader-cache-poll`,
  `refresh-queue`, `score`, `refresh-leader`. **Keep `cohort-snapshot`** only.
- **DB tables/objects:** `wallets`, `fills`, `fundings`, `ledger_updates`,
  `scores`, `wallet_tags`, `leader_cache`, `discovery_queue`, `audit_log`, the
  `leaders` view, and `wallets.history_deepened_at` / `history_oldest_ms`. **Keep
  only `cohort_sentiment_history`.**
- **API queries** that read the above (`leaders.ts`, trader-detail/asset queries
  built on `fills`/`scores`), replaced by EP-module reads.
- **UI:** copy-trade / Mirror framing and any score/composite displays.

**Bonus:** dropping `fills` reclaims **~364 MB** — this alone resolves the
capacity crunch and unblocks per-market sentiment history *without* the DB
upgrade.

## Out of scope (separate tracks)

- **Trader-page full restructure** — the "new product" for the trader surface.
- **Sentiment-data product** — future exploration; the `cohort_sentiment_history`
  recorder is its data foundation.
- **HL-native data pipeline** — `2026-06-25-hyperdash-independence-migration.md`.

## Verification

- `pnpm check` + `pnpm build` pass at repo root.
- Grep `apps/api/src` + `packages/` for every removed table/column/function name —
  no stale references (STRICT RULE).
- DB drops go through hand-authored migrations + `_journal.json` (`db:generate` is
  broken on main — meta snapshots stop at 0005).
