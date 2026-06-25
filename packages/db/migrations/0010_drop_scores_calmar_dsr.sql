-- Drop the long-dead `scores.calmar` / `scores.dsr` columns.
--
-- Migration 0003 already dropped these, but at the time main still read them so
-- they were manually re-added to the live DB as a stopgap. Main was later
-- cleaned up (no code references either column) but the columns were never
-- re-dropped. This finishes that cleanup. IF EXISTS so it's a no-op on any DB
-- where they're already gone.
ALTER TABLE "scores" DROP COLUMN IF EXISTS "calmar";--> statement-breakpoint
ALTER TABLE "scores" DROP COLUMN IF EXISTS "dsr";
