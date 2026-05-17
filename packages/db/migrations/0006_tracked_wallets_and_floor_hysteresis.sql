-- Hysteresis source: stamped by leader-cache-poll when live equity drops
-- below MIN_ACCOUNT_VALUE_USD. Consumed by the `tracked_wallets` view's
-- CASE predicate so wallets bouncing around the floor don't flicker in and
-- out of lists. See docs/plans/2026-05-17-tracked-wallets-view-design.md.
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "last_below_floor_at" timestamptz;--> statement-breakpoint

-- Single source of truth for "wallets we follow + present." Replaces the
-- five parallel definitions inventoried in the design doc: the existing
-- `leaders` view, `wallets.curated`, `wallets.score IS NOT NULL`, and the
-- ad-hoc SQL inside `ws-live-subscriber`. Every list query (web) and
-- cohort job (worker) joins this view; the COALESCE on live equity means
-- withdrawals are reflected within the leader-cache-poll cadence (~60s)
-- without any denormalized booleans to maintain.
--
-- Hysteresis: a wallet that was below the floor in the last 7 days needs
-- to climb back over a higher bar (75k vs 50k) before re-appearing. Keeps
-- the existing one-way semantics (downgrade fast, re-promote deliberate)
-- without the gate-reconcile helper writing to multiple columns.
CREATE OR REPLACE VIEW "tracked_wallets" AS
SELECT
  w.address,
  w.master_address,
  COALESCE(lc.account_value, w.account_value) AS effective_equity,
  lc.account_value AS live_equity,
  lc.last_refreshed_at AS live_refreshed_at,
  w.last_below_floor_at,
  s.score,
  s.decay_flag,
  s.total_trades,
  s.profit_factor,
  s.max_drawdown_pct
FROM wallets w
LEFT JOIN leader_cache lc ON lc.address = w.address
JOIN scores s ON s.address = w.address
WHERE w.is_agent = false
  AND COALESCE(lc.account_value, w.account_value) >=
        CASE
          WHEN w.last_below_floor_at IS NOT NULL
               AND w.last_below_floor_at > now() - interval '7 days'
          THEN 75000
          ELSE 50000
        END
  AND w.last_seen_at >= now() - interval '21 days'
  AND s.score IS NOT NULL
  AND (s.decay_flag IS NULL OR s.decay_flag <> 'red')
  AND s.total_trades >= 50
  AND s.profit_factor >= 1.0
  AND s.max_drawdown_pct < 0.5;--> statement-breakpoint

COMMENT ON VIEW "tracked_wallets" IS
  'Canonical "wallets we follow and present" set. Every reader (web list queries, worker cohort jobs, analytics) joins this view. Live-equity check via COALESCE(leader_cache, wallets) auto-excludes withdrawn wallets within leader-cache-poll cadence. Hysteresis via last_below_floor_at + 75k re-entry floor keeps bouncing wallets stable. See docs/plans/2026-05-17-tracked-wallets-view-design.md.';--> statement-breakpoint

-- `leaders` is NOT dropped here. It's still read by leader-cache-poll,
-- hip3-poll-subscriber, trades-coin-subscriber, and analytics.ts. Those
-- readers migrate to `tracked_wallets` in code changes landing alongside
-- this migration; a follow-up migration drops `leaders` once the cutover
-- is verified.
