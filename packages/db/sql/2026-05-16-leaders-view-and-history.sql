-- Applied out-of-band on 2026-05-16. Not in drizzle/migrations because main
-- still has the drift documented in CLAUDE.md. When data-sources lands and
-- migrations are reconciled, fold this in. See:
--   - docs/plans/2026-05-16-fills-retention-and-deepen.md (full spec)

-- 1. Quality-filtered leader set (~69 today). Used as the canonical
--    "currently worth tracking" address list by the firehose, leader-cache
--    poll, hip3 poll, and the web's scope='tracked' queries.
CREATE OR REPLACE VIEW leaders AS
SELECT
  w.address,
  w.account_value,
  w.master_address,
  w.curated,
  s.score,
  s.decay_flag,
  s.total_trades,
  s.profit_factor,
  s.max_drawdown_pct
FROM wallets w
JOIN scores  s ON s.address = w.address
WHERE w.is_agent          = false
  AND w.account_value    >= 50000
  AND w.last_seen_at     >= now() - interval '21 days'
  AND s.score             IS NOT NULL
  AND (s.decay_flag IS NULL OR s.decay_flag <> 'red')
  AND s.total_trades     >= 50
  AND s.profit_factor    >= 1.0
  AND s.max_drawdown_pct  < 0.50;

COMMENT ON VIEW leaders IS
  'Quality-filtered trader set (~69 today). See docs/plans/2026-05-16-fills-retention-and-deepen.md.';

-- 2. Wallets columns for the on-demand "Show all history" flow.
--    history_deepened_at = set when user clicks Show all history; retention
--    cron skips these wallets.
--    history_oldest_ms   = earliest block_time_ms in fills for this wallet
--    (powers the UI badge "Last N days").
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS history_deepened_at timestamptz;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS history_oldest_ms   bigint;

COMMENT ON COLUMN wallets.history_deepened_at IS
  'Set when user clicked Show all history on the trader profile; retention cron skips this wallet.';
COMMENT ON COLUMN wallets.history_oldest_ms IS
  'Earliest block_time_ms we have stored for this wallet in fills.';
