import { sql } from 'drizzle-orm';
import { cohortSentimentHistory } from '@copytrade/db';
import { db } from '../db.js';
import { log } from '../log.js';

/**
 * Snapshot Hyperdash cohort sentiment into `cohort_sentiment_history`.
 *
 * Hyperdash's `perpsMarketParticipation` recomputes every ~5 min. We pull it,
 * roll each PnL cohort up to one aggregate row (total long/short trader counts +
 * USD notional across all its markets), and persist it keyed on Hyperdash's own
 * snapshot timestamp. So a row per cohort per ~5 min — the raw inputs for the
 * "how did sentiment move over time" charts.
 *
 * What we DON'T do here: derive net/bias (that's the single canonical `biasFor`
 * in apps/api's cohort-sentiment query — we only store raw inputs), or store the
 * per-market breakdown (too large for current DB headroom; the live Sentiment
 * tab still reads Hyperdash directly for the bars).
 *
 * Idempotent: `captured_at` is Hyperdash's immutable snapshot id, so re-running
 * between recomputes inserts nothing. Run every 5 min (cron). Prunes its own old
 * rows to stay within a bounded window.
 *
 * Endpoint provenance + field reference: `.claude/skills/hyperdash-top-traders`.
 */

const HYPERDASH_GRAPHQL = 'https://api.hyperdash.com/graphql';

/** Keep ~45 days of 5-min snapshots (6 cohorts × 288/day). The DB runs near its
 *  size cap, so this window is deliberately bounded; widen once space frees up. */
const RETENTION_DAYS = 45;

const QUERY = `query GetPerpsMarketParticipation {
  analytics { perpsMarketParticipation {
    timestamp
    pnlCohorts {
      cohortId
      markets { longTraderCount shortTraderCount totalLongNotional totalShortNotional }
    }
  } }
}`;

// A browser UA is required — the endpoint blocks default fetch/curl agents.
const HEADERS = {
  'content-type': 'application/json',
  origin: 'https://hyperdash.com',
  referer: 'https://hyperdash.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

interface RawMarket {
  longTraderCount: number | null;
  shortTraderCount: number | null;
  totalLongNotional: number | string | null;
  totalShortNotional: number | string | null;
}
interface RawCohort {
  cohortId: string;
  markets: RawMarket[] | null;
}

export async function runCohortSnapshot(): Promise<void> {
  const startedAt = Date.now();
  log.info('cohort-snapshot.start');

  const res = await fetch(HYPERDASH_GRAPHQL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ operationName: 'GetPerpsMarketParticipation', query: QUERY }),
  });
  if (!res.ok) {
    throw new Error(`hyperdash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: {
      analytics?: { perpsMarketParticipation?: { timestamp?: string; pnlCohorts?: RawCohort[] } };
    };
    errors?: unknown;
  };
  if (json.errors) {
    throw new Error(`hyperdash graphql errors: ${JSON.stringify(json.errors).slice(0, 200)}`);
  }

  const part = json.data?.analytics?.perpsMarketParticipation;
  const ts = part?.timestamp;
  const cohorts = part?.pnlCohorts ?? [];
  if (!ts || cohorts.length === 0) {
    log.warn('cohort-snapshot.empty');
    return;
  }
  const capturedAt = new Date(ts);

  const rows = cohorts.map((c) => {
    let longTraders = 0;
    let shortTraders = 0;
    let longNotional = 0;
    let shortNotional = 0;
    for (const m of c.markets ?? []) {
      longTraders += m.longTraderCount ?? 0;
      shortTraders += m.shortTraderCount ?? 0;
      longNotional += Number(m.totalLongNotional) || 0;
      shortNotional += Number(m.totalShortNotional) || 0;
    }
    return {
      capturedAt,
      cohortId: c.cohortId,
      longTraders,
      shortTraders,
      longNotional: longNotional.toFixed(2),
      shortNotional: shortNotional.toFixed(2),
    };
  });

  // `captured_at` is Hyperdash's snapshot id — re-running before they recompute
  // is a no-op, so do nothing on conflict.
  const inserted = await db()
    .insert(cohortSentimentHistory)
    .values(rows)
    .onConflictDoNothing({
      target: [cohortSentimentHistory.capturedAt, cohortSentimentHistory.cohortId],
    })
    .returning({ cohortId: cohortSentimentHistory.cohortId });

  const pruned = await db()
    .delete(cohortSentimentHistory)
    .where(sql`${cohortSentimentHistory.capturedAt} < now() - ${`${RETENTION_DAYS} days`}::interval`)
    .returning({ cohortId: cohortSentimentHistory.cohortId });

  log.info(
    {
      capturedAt: capturedAt.toISOString(),
      cohorts: rows.length,
      inserted: inserted.length,
      pruned: pruned.length,
      ms: Date.now() - startedAt,
    },
    'cohort-snapshot.done',
  );
}
