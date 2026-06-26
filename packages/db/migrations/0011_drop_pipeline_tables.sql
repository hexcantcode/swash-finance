-- Drop the dead DB ingest/scoring pipeline. After the EP Single-Roster pivot
-- the app reads everything from Hyperdash (the ep/ module); no code references
-- these tables/views anymore. Only `cohort_sentiment_history` survives.
--
-- Dropping `fills` (~364 MB) also reclaims the bulk of the DB size cap.
-- Views are dropped first (they depend on the tables); CASCADE clears any
-- remaining dependent objects. IF EXISTS so it's a no-op on a clean DB.
DROP VIEW IF EXISTS "leaders" CASCADE;--> statement-breakpoint
DROP VIEW IF EXISTS "tracked_wallets" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "audit_log" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "discovery_queue" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "leader_cache" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "wallet_tags" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "scores" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "ledger_updates" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "fundings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "fills" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "wallets" CASCADE;
