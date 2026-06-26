import {
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Time series of Hyperdash cohort sentiment — one row per snapshot per PnL
// cohort, capturing the cohort's aggregate long/short positioning (trader
// counts + notional) across all its markets. Written every ~5 min by the
// `cohort-snapshot` worker (matching Hyperdash's recompute cadence) so we can
// chart how each cohort's bias moves over time. Aggregate-only by design: the
// per-market breakdown is far too large for the current DB headroom, so the
// live Sentiment tab still reads Hyperdash directly for the bars.
//
// `capturedAt` is Hyperdash's own snapshot timestamp (the upsert key), so
// re-running the cron between recomputes is a no-op. Net long/short bias is NOT
// stored — it's derived from the notionals by the one canonical `biasFor` in
// apps/api's cohort-sentiment query. Pruned to a bounded retention window.
export const cohortSentimentHistory = pgTable(
  'cohort_sentiment_history',
  {
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    cohortId: text('cohort_id').notNull(),
    longTraders: integer('long_traders').notNull(),
    shortTraders: integer('short_traders').notNull(),
    longNotional: numeric('long_notional', { precision: 30, scale: 2 }).notNull(),
    shortNotional: numeric('short_notional', { precision: 30, scale: 2 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.capturedAt, t.cohortId] }),
    index('idx_cohort_sentiment_series').on(t.cohortId, t.capturedAt.desc()),
  ],
);

export type CohortSentimentRow = typeof cohortSentimentHistory.$inferSelect;
export type NewCohortSentimentRow = typeof cohortSentimentHistory.$inferInsert;
