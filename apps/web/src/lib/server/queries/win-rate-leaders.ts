import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { fills, scores, wallets } from '@copytrade/db';
import {
  isMarketMakerPattern,
  MIN_ACCOUNT_VALUE_USD,
  MIN_ROUND_TRIPS,
} from '@copytrade/scoring';
import { db } from '../db.js';
import { listBestAssetsByWinRate } from './best-asset.js';
import { listHoldingsByAddress, type HoldingsByAddress } from './holdings.js';

export interface WinRateLeaderRow {
  address: string;
  /** Fraction in [0, 1] — `scores.win_rate`. */
  win_rate: number | null;
  /** Position open→flat cycles — `scores.total_round_trips`. */
  total_round_trips: number;
  /**
   * Most-recent closed round trips for this trader (newest last), capped at
   * `LAST_CLOSED_LIMIT` entries. Each entry's sign drives a green/red pill
   * in the Win Rate panel — `pnlUsd > 0` = win, `< 0` = loss.
   */
  last_closed: Array<{ closeTimeMs: number; pnlUsd: number }>;
  /** "Alfa" — coin this trader has the highest fill-level win rate on with
   *  ≥ 5 trades on that coin. Null when no coin clears the sample floor. */
  alfa_coin: string | null;
  /** Currently-open positions snapshot — top 3 by notional + total count.
   *  Drives the Holdings cell on the traders page. */
  holdings: HoldingsByAddress;
}

const LAST_CLOSED_LIMIT = 5;

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

  // First pass: drop MM-shaped wallets. We still over-fetch by 10× so the
  // post-filter has plenty of candidates left.
  const passMM: Array<Omit<WinRateLeaderRow, 'last_closed' | 'alfa_coin' | 'holdings'>> = [];
  for (const r of candidates) {
    const isMM = isMarketMakerPattern({
      makerShare: numOrNull(r.maker_share),
      avgHoldSeconds: r.avg_hold_seconds,
      longShortRatio: numOrNull(r.long_short_ratio),
      totalFills: r.total_fills ?? null,
    });
    if (isMM) continue;
    passMM.push({
      address: r.address,
      win_rate: numOrNull(r.win_rate),
      total_round_trips: r.total_round_trips ?? 0,
    });
  }

  // Second pass: fetch recent closing-fills for every MM-passing candidate
  // in parallel, then drop wallets that have nothing in the `fills` table to
  // pill — surfacing a wallet with five grey pills isn't useful. Wallets
  // can pass the scoring win-rate gate via historic fills that are no
  // longer in the live `fills` table (purged, ingested via aggregates,
  // etc.) — those would render empty pills, so we skip them and let the
  // next-best candidate take the slot.
  const passingAddresses = passMM.map((r) => r.address);
  const [lastClosedByAddr, alfaByAddress, holdingsByAddress] = await Promise.all([
    getRecentClosingFills(passingAddresses, LAST_CLOSED_LIMIT),
    listBestAssetsByWinRate(passingAddresses),
    listHoldingsByAddress(passingAddresses),
  ]);
  const result: WinRateLeaderRow[] = [];
  for (const r of passMM) {
    if (result.length >= limit) break;
    const lastClosed = lastClosedByAddr.get(r.address) ?? [];
    if (lastClosed.length === 0) continue;
    result.push({
      ...r,
      last_closed: lastClosed,
      alfa_coin: alfaByAddress.get(r.address) ?? null,
      holdings: holdingsByAddress.get(r.address) ?? { top: [], total: 0 },
    });
  }
  return result;
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Most-recent N closing fills per trader. We use the per-fill `closed_pnl`
 * (signed PnL booked at the moment of that fill — already provided by HL,
 * we don't recompute) and treat each non-zero closing as one pill: green
 * when positive, red when negative.
 *
 * This is intentionally not a strict round-trip replay (cf. the multi-coin
 * position-tracking version in `asset-detail.ts`). The replay misses traders
 * who haven't returned to flat inside any reasonable fill window — common
 * for big-account rollers — and would leave their Last 5 panel empty even
 * though they've booked plenty of partial closes. Per-fill closings are
 * cheaper (one indexed SQL, no replay), always populated when any close
 * exists, and match the visual UX intent: a quick recent-results strip.
 *
 * Trade-off: a single round trip that closes across multiple fills counts
 * as multiple pills. For the "are they hot or cold lately" read this is
 * actually informative; for an exact round-trip count, use the leader
 * detail page.
 */
async function getRecentClosingFills(
  addresses: string[],
  limitPer: number,
): Promise<Map<string, Array<{ closeTimeMs: number; pnlUsd: number }>>> {
  const map = new Map<string, Array<{ closeTimeMs: number; pnlUsd: number }>>();
  if (addresses.length === 0) return map;
  const conn = db();
  await Promise.all(
    addresses.map(async (addr) => {
      const rows = await conn
        .select({
          blockTimeMs: fills.blockTimeMs,
          closedPnl: fills.closedPnl,
        })
        .from(fills)
        .where(and(eq(fills.userAddress, addr), sql`${fills.closedPnl} <> 0`))
        .orderBy(desc(fills.blockTimeMs))
        .limit(limitPer);
      // Pulled newest-first from SQL; reverse to oldest-first so the UI
      // can render newest on the right edge.
      const tail = rows
        .map((r) => ({
          closeTimeMs: Number(r.blockTimeMs),
          pnlUsd: Number.parseFloat(r.closedPnl),
        }))
        .reverse();
      map.set(addr, tail);
    }),
  );
  return map;
}
