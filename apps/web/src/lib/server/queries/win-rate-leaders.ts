import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { scores, wallets } from '@copytrade/db';
import { MIN_ACCOUNT_VALUE_USD, MIN_ROUND_TRIPS } from '@copytrade/scoring';
import { db } from '../db.js';

export interface WinRateLeaderRow {
  address: string;
  /** Fraction in [0, 1] — `scores.win_rate`. */
  win_rate: number | null;
  total_trades: number;
}

/**
 * Top N traders by win rate, drawn from the same population as the leaderboard
 * (see `listLeaders` baseFilters: not an agent, scored, account value ≥
 * `MIN_ACCOUNT_VALUE_USD`) and restricted to the latest scoring batch so we
 * don't surface dormant wallets whose `winRate` was frozen by a long-ago
 * scoring run (`runScoreRecompute` skips wallets inactive >180d). Adds a
 * sample-size floor of `MIN_ROUND_TRIPS` to avoid 100% win rates from a
 * handful of trades. Canonical win rate value: `scores.winRate`; this query
 * only ranks it.
 */
export async function listTopWinRate(limit = 5): Promise<WinRateLeaderRow[]> {
  // "Latest scoring": within 24h of the most recent score write. The score
  // job runs daily and writes all candidates in one batch, so anyone outside
  // this window was excluded from the latest run (dormant, dropped, etc).
  const latestScoringCutoff = sql`(select max(${scores.computedAt}) - interval '24 hours' from ${scores})`;

  const rows = await db()
    .select({
      address: wallets.address,
      win_rate: scores.winRate,
      total_trades: scores.totalTrades,
    })
    .from(wallets)
    .innerJoin(scores, eq(scores.address, wallets.address))
    .where(
      and(
        eq(wallets.isAgent, false),
        isNotNull(wallets.score),
        sql`${wallets.accountValue} >= ${MIN_ACCOUNT_VALUE_USD}`,
        isNotNull(scores.winRate),
        gte(scores.totalTrades, MIN_ROUND_TRIPS),
        sql`${scores.computedAt} >= ${latestScoringCutoff}`,
      ),
    )
    .orderBy(desc(scores.winRate))
    .limit(limit);

  return rows.map((r) => ({
    address: r.address,
    win_rate: numOrNull(r.win_rate),
    total_trades: r.total_trades ?? 0,
  }));
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
