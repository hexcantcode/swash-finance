import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { scores, wallets } from '@copytrade/db';
import {
  isMarketMakerPattern,
  MIN_ACCOUNT_VALUE_USD,
  MIN_ROUND_TRIPS,
} from '@copytrade/scoring';
import { db } from '../db.js';

export interface WinRateLeaderRow {
  address: string;
  /** Fraction in [0, 1] — `scores.win_rate`. */
  win_rate: number | null;
  /** Position open→flat cycles — `scores.total_round_trips`. */
  total_round_trips: number;
}

/**
 * Top N traders by win rate, drawn from the same population as the leaderboard
 * (see `listLeaders` baseFilters: not an agent, scored, account value ≥
 * `MIN_ACCOUNT_VALUE_USD`) and restricted to the latest scoring batch so we
 * don't surface dormant wallets whose `winRate` was frozen by a long-ago
 * scoring run (`runScoreRecompute` skips wallets inactive >180d). Two further
 * filters keep the list meaningful:
 *
 *   - `total_round_trips >= MIN_ROUND_TRIPS` — sample-size floor on real
 *     open→flat cycles (not raw fills), to avoid 100% rates from a handful
 *     of trades.
 *   - Excludes market-maker / grid-bot wallets via `isMarketMakerPattern`
 *     (canonical predicate in `@copytrade/scoring/eligibility.ts`). MMs tend
 *     to dominate win-rate rankings because of maker rebates, so we drop
 *     them here. Applied in JS over an over-fetched candidate set so the
 *     ranking source-of-truth stays inside that one function.
 *
 * Canonical win rate value: `scores.winRate`; this query only ranks it.
 */
export async function listTopWinRate(limit = 5): Promise<WinRateLeaderRow[]> {
  // "Latest scoring": within 24h of the most recent score write. The score
  // job runs daily and writes all candidates in one batch, so anyone outside
  // this window was excluded from the latest run (dormant, dropped, etc).
  const latestScoringCutoff = sql`(select max(${scores.computedAt}) - interval '24 hours' from ${scores})`;

  // Over-fetch so the MM post-filter can drop bot-shaped wallets without
  // leaving the table short. 10× is generous given MMs typically dominate
  // the very top of the win-rate distribution.
  const candidates = await db()
    .select({
      address: wallets.address,
      win_rate: scores.winRate,
      total_round_trips: scores.totalRoundTrips,
      maker_share: scores.makerTakerRatio,
      avg_hold_seconds: scores.avgHoldSeconds,
      long_short_ratio: scores.longShortRatio,
      total_fills: scores.totalTrades,
    })
    .from(wallets)
    .innerJoin(scores, eq(scores.address, wallets.address))
    .where(
      and(
        eq(wallets.isAgent, false),
        isNotNull(wallets.score),
        sql`${wallets.accountValue} >= ${MIN_ACCOUNT_VALUE_USD}`,
        isNotNull(scores.winRate),
        gte(scores.totalRoundTrips, MIN_ROUND_TRIPS),
        sql`${scores.computedAt} >= ${latestScoringCutoff}`,
      ),
    )
    .orderBy(desc(scores.winRate))
    .limit(limit * 10);

  const result: WinRateLeaderRow[] = [];
  for (const r of candidates) {
    if (result.length >= limit) break;
    const isMM = isMarketMakerPattern({
      makerShare: numOrNull(r.maker_share),
      avgHoldSeconds: r.avg_hold_seconds,
      longShortRatio: numOrNull(r.long_short_ratio),
      totalFills: r.total_fills ?? null,
    });
    if (isMM) continue;
    result.push({
      address: r.address,
      win_rate: numOrNull(r.win_rate),
      total_round_trips: r.total_round_trips ?? 0,
    });
  }
  return result;
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
