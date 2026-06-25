-- Time series of Hyperdash cohort sentiment. One row per ~5-min snapshot per
-- PnL cohort, holding that cohort's aggregate long/short positioning across all
-- its markets (trader counts + USD notional). Written by the `cohort-snapshot`
-- worker so we can chart how each cohort's bias moves over time.
--
-- `captured_at` is Hyperdash's own snapshot timestamp and the upsert key, so
-- re-running the cron between upstream recomputes is a no-op. Net long/short
-- bias is NOT stored — it's derived from the notionals by the single canonical
-- `biasFor` in apps/api's cohort-sentiment query. Pruned to a bounded window by
-- the same job.
CREATE TABLE IF NOT EXISTS "cohort_sentiment_history" (
	"captured_at" timestamp with time zone NOT NULL,
	"cohort_id" text NOT NULL,
	"long_traders" integer NOT NULL,
	"short_traders" integer NOT NULL,
	"long_notional" numeric(30, 2) NOT NULL,
	"short_notional" numeric(30, 2) NOT NULL,
	CONSTRAINT "cohort_sentiment_history_captured_at_cohort_id_pk" PRIMARY KEY("captured_at","cohort_id")
);

-- Per-cohort time series read (e.g. "EP overall bias, last 24h").
CREATE INDEX IF NOT EXISTS "idx_cohort_sentiment_series" ON "cohort_sentiment_history" ("cohort_id","captured_at" DESC);
