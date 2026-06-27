-- Discovery source for each wallet — which ingest first surfaced it.
--   'hl_leaderboard' (default) = Hyperliquid's official leaderboard.
--   'hyperdash'                = Hyperdash's curated copytraders group
--                                (the hyperdash-ingest job).
-- Drives the "primary roster" ordering in leaders.ts (hyperdash floats to the
-- top of the trader list). Sticky: leaderboard-ingest never overwrites it, so a
-- wallet stays marked 'hyperdash' even if HL also lists it.
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'hl_leaderboard';

-- Partial index — only the (small) non-default set is worth indexing, since
-- leaders.ts filters/orders on `source = 'hyperdash'`.
CREATE INDEX IF NOT EXISTS "idx_wallets_source" ON "wallets" ("source") WHERE "source" <> 'hl_leaderboard';
