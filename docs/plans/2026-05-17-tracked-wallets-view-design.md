# Single-source-of-truth for "wallets we follow + present"

**Status:** spec, pre-implementation. Queued behind the `data-sources`-branch migration drift reconciliation (see CLAUDE.md).
**Date:** 2026-05-17.
**Supersedes:** the gate-reconciliation patches landed alongside this doc — once this design is in, the helper at `apps/worker/src/lib/gate-reconcile.ts` and the live-equity recheck in `leaderboard-poll.ts` become vestigial and should be removed.

## Problem

There is no single answer to "is this wallet in our universe?" The codebase carries **five** parallel definitions, each written by a different job and read by a different consumer:

| # | Definition | Writer | Reader(s) |
|---|---|---|---|
| 1 | `leaders` SQL view (`w.account_value ≥ 50k AND s.score IS NOT NULL AND s.decay_flag ≠ 'red' AND s.total_trades ≥ 50 AND s.profit_factor ≥ 1.0 AND s.max_drawdown_pct < 0.5 AND last_seen_at within 21d`) | DB (computed) | `leader-cache-poll`, `hip3-poll-subscriber`, `trades-coin-subscriber`, `analytics.ts` |
| 2 | `wallets.curated` bool | `score.ts` (gate passed && score computed), `gate-reconcile.ts` (downgrade) | `/traders` curated tab (`leaders.ts`) |
| 3 | `wallets.winner` bool + `winner_rank` | `leaderboard-poll.reconcileWinners`, `gate-reconcile.ts` | `/traders` Winners strip (`weekly-leaders.ts`, `leaders.ts`) |
| 4 | `wallets.score IS NOT NULL` | `score.ts`, `gate-reconcile.ts` | `/traders` general list (`leaders.ts`), `win-rate-leaders.ts` |
| 5 | `ws-live-subscriber`'s in-job SQL (`account_value ≥ MIN AND hl_pnl_7d_usd IS NOT NULL`) — different shape from (1) | the subscriber | internal cohort selection |

The `leaders` view uses `wallets.account_value` (HL leaderboard snapshot, refreshed by `leaderboard-poll` every 15 min and lagged behind the live `clearinghouseState` API). The UI tabs use denormalized booleans on `wallets` that have to be actively maintained by whatever process owns each write path. Miss one write path on any change and a wallet leaks into a list it shouldn't be on.

The bug that prompted this work is a textbook case:

- Wallet `0x1e48...` ran a $11.7M account up to +77% / +$5M PnL over 30d, score 99.
- Trader withdrew almost everything; live equity dropped to ~$128.
- `wallets.account_value` stayed at $11.7M because the leaderboard snapshot still reported the peak.
- `passesGate` only runs at scoring time (daily, 02:00 UTC), so for up to 24h the wallet kept `score=99` and `curated=true`.
- It appeared on `/traders` with a 99 score next to $128 equity (in the live cache).

The immediate fix shipped today closed the gap by adding a write-time live-equity recheck in three places (`leader-cache-poll`, `ws-live-subscriber`, the scoring job's gate input). That works, but it adds three more consistency obligations to a system that already has too many. The next time we add a list query or a cohort job, whoever writes it will have to remember every flag.

## Design

### One view, derived everything

Collapse the five definitions into a single SQL view that joins live equity from `leader_cache` into the existing `leaders` predicate. Every reader — web, worker, analytics — reads from this view.

```sql
CREATE OR REPLACE VIEW tracked_wallets AS
SELECT
  w.address,
  w.master_address,
  COALESCE(lc.account_value, w.account_value) AS effective_equity,
  lc.account_value AS live_equity,
  lc.last_refreshed_at AS live_refreshed_at,
  s.score,
  s.decay_flag,
  s.total_trades,
  s.profit_factor,
  s.max_drawdown_pct
FROM wallets w
LEFT JOIN leader_cache lc ON lc.address = w.address
JOIN scores s ON s.address = w.address
WHERE w.is_agent = false
  AND COALESCE(lc.account_value, w.account_value) >= 50000
  AND w.last_seen_at >= now() - interval '21 days'
  AND s.score IS NOT NULL
  AND (s.decay_flag IS NULL OR s.decay_flag <> 'red')
  AND s.total_trades >= 50
  AND s.profit_factor >= 1.0
  AND s.max_drawdown_pct < 0.5;

COMMENT ON VIEW tracked_wallets IS
  'Canonical "wallets we follow and present" set. Every reader (web list queries, worker cohort jobs, analytics) joins this. Live-equity check via COALESCE(leader_cache, wallets) means the view automatically reflects withdrawals within the leader-cache-poll cadence (~60s) — no denormalized booleans to maintain.';
```

The `leaders` view is renamed to `tracked_wallets` and absorbs the live-equity COALESCE. Single name, single rule.

### What changes downstream

**Workers** — replace `SELECT address FROM leaders` with `SELECT address FROM tracked_wallets` in:

- `apps/worker/src/jobs/leader-cache-poll.ts`
- `apps/worker/src/jobs/hip3-poll-subscriber.ts`
- `apps/worker/src/jobs/trades-coin-subscriber.ts`
- `apps/worker/src/jobs/ws-live-subscriber.ts` — replace the in-job SQL (definition #5) with the same query. The subscriber's cohort becomes identical to every other cohort.

**Web list queries** — replace `eq(wallets.curated, true)` / `isNotNull(wallets.score)` filters with `INNER JOIN tracked_wallets tw ON tw.address = wallets.address`:

- `apps/web/src/lib/server/queries/leaders.ts` — drop the `isNotNull(score)`, `eq(curated, true)`, `eq(winner, true)` branches; replace with the join. `winnersOnly` filter additionally adds `eq(wallets.winner, true)`.
- `apps/web/src/lib/server/queries/weekly-leaders.ts` — keep `eq(wallets.winner, true)` (winner is a ranked subset), but JOIN tracked_wallets so a wallet that's no longer tracked can never appear even if `winner` is stale.
- `apps/web/src/lib/server/queries/win-rate-leaders.ts` — same join, drop `isNotNull(score)`.
- `apps/web/src/lib/server/queries/holdings.ts`, `recent-trades.ts`, `best-asset.ts`, `assets.ts` — if they currently filter on tracked-ness implicitly (or not at all), add the join so they get the same set.

**`leaderboard-poll.reconcileWinners`** — the live-equity prefilter we just added becomes simpler: clip the candidate list to `address IN (SELECT address FROM tracked_wallets)` instead of fetching `leader_cache` ourselves. The view does the work.

### The denormalized flags

- **`wallets.curated`** — remove the column. Every reader uses `tracked_wallets` instead. Migration drops the column and the partial index `idx_wallets_curated`.
- **`wallets.score`** — keep. It's both a value (0–100, surfaced on the UI) and a flag for "do we have a current score?" The view's `s.score IS NOT NULL` clause means a score going to `NULL` (e.g., by the scoring run when inputs are missing) excludes the wallet automatically.
- **`wallets.winner`** + `winner_rank` — keep. This is a ranked concept (top-10 by 7d PnL with ordinal positions) that can't be derived from the view alone. `reconcileWinners` writes it; readers JOIN `tracked_wallets` to constrain to the tracked set.

### Re-promotion semantics

The previous design (gate-reconcile helper, shipped today) had an explicit asymmetry: live-equity drops took effect within ~60s, but re-promotion required the daily scoring cron. The product reason — "if there will be wallets copytrading it we'll preserve in the list" — is about avoiding bouncing wallets in and out of lists when equity oscillates around the floor.

A view-based design re-promotes automatically the moment live equity climbs back above $50k, which we don't want. Two ways to preserve the one-way behavior:

**Option A — hysteresis predicate in the view.** Add a `wallets.last_below_floor_at` column written by a periodic reconciliation. The view requires a higher floor for any wallet that was below the floor recently:

```sql
AND COALESCE(lc.account_value, w.account_value) >=
      CASE WHEN w.last_below_floor_at IS NOT NULL
                AND w.last_below_floor_at > now() - interval '7 days'
           THEN 75000
           ELSE 50000
      END
```

One column, written in one place (a small reconciliation hook in leader-cache-poll that just stamps the timestamp — no curated/score writes). Hysteresis is encoded in the view, so all readers honor it.

**Option B — keep the score=null guard from today's design.** The view already requires `s.score IS NOT NULL`. The gate-reconcile helper continues to write `s.score = NULL` when live equity drops; re-promotion still requires a scoring run to repopulate `s.score`. This is essentially what we have now, but with the helper writes scoped to a single column and the view handling everything else.

Recommendation: **Option A**. It removes the gate-reconcile helper entirely and makes the rule visible in the view definition. Option B keeps a write path we'd prefer to retire.

### Indexing

- Drop `idx_wallets_curated` (partial index on a deleted column).
- Add `idx_leader_cache_account_value` so the view's COALESCE-with-floor predicate is fast even on cold pages.
- The view itself is not materialized — `tracked_wallets` evaluates per query. Worker `SELECT address FROM tracked_wallets` runs once per 60s cycle; web list queries already pay an index scan over `wallets`, the JOIN adds two more index lookups per row. Acceptable; revisit only if `pg_stat_statements` flags it.

## Migration path

The current main branch is mid-drift (see CLAUDE.md). Do not land this until `data-sources` has been merged and the migration story is straightened out.

Once main and the live DB agree on schema:

1. Add a Drizzle migration that creates `tracked_wallets` (replacing `leaders`) and adds `wallets.last_below_floor_at`.
2. Migrate every reader: workers first (smaller blast radius — they read once per cycle), then web queries.
3. Backfill `wallets.last_below_floor_at` from current state (anything currently below floor in `leader_cache` gets stamped to `now()`).
4. Delete `apps/worker/src/lib/gate-reconcile.ts` and the `downgradeIfBelowFloor` call sites in `leader-cache-poll.ts` and `ws-live-subscriber.ts`.
5. Replace the live-equity prefilter in `leaderboard-poll.filterWinnersByLiveEquity` with a `tracked_wallets` join.
6. Drop `wallets.curated` and `idx_wallets_curated`.

Each step is independently reviewable. Step 6 is the only destructive one and only fires after steps 1–5 have been in main for at least one release.

## What this buys

- One SQL expression defines "wallets we follow + present." Every consumer reads it. Diverging definitions become structurally impossible.
- The original bug class (snapshot equity drifts from live equity, list shows wallets that no longer qualify) cannot recur — the view evaluates the live value on every read.
- New list queries / cohort jobs don't have to remember any flags. They `JOIN tracked_wallets` and are correct by construction.
- The number of write paths that touch list-membership state drops from five to one (`reconcileWinners`, which writes ranking, not membership).
- The "live-equity drift" obligation moves from application code to a single SQL predicate. CLAUDE.md's "one source of truth per data point" rule is satisfied for the most-important data point on the site: which wallets exist.
