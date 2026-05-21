-- Adds the HL "day" (1d) PnL window to wallets, alongside the existing 7d/30d
-- columns. Powers the mobile home screen's Top Traders 1d/7d/1m filter.
-- Populated by the leaderboard-poll job from HL's `day` portfolio bucket.
--
-- Applied out-of-band (not via drizzle-kit generate) because the drizzle meta
-- snapshots have unrelated drift on scores.score/composite_score that would
-- otherwise ride along in a generated migration. Additive + idempotent; safe.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS hl_pnl_1d_usd   numeric(30, 8);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS hl_roi_1d       numeric(20, 8);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS hl_volume_1d_usd numeric(30, 8);
