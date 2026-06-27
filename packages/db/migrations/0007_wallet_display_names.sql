-- HL leaderboard display names — user-set on app.hyperliquid.xyz, carried in
-- the leaderboard payload (~3-4% of wallets set one). UI prefers this over
-- the short address; Swash-side custom naming comes later with
-- personalization. Populated by the leaderboard-ingest/poll jobs.
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "display_name" text;
