import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { scores, walletTags, wallets } from '@copytrade/db';
import { MIN_ACCOUNT_VALUE_USD } from '@copytrade/scoring';
import { db } from '../db.js';

export interface LeaderCard {
  address: string;
  composite_score: number | null;
  /** Current account equity (USD) — `wallets.accountValue`. */
  account_value: number | null;
  /** The "Profile" archetype (`wallets.primary_tag`) — alpha / veteran /
   *  rising_star / specialist / allrounder. */
  primary_tag: string | null;
  /** Non-profile tags as `"<type>:<value>"` (currently `heat:` / `size:`). */
  secondary_tags: string[];
  metrics: {
    total_pnl_usd: number | null;
    total_volume_usd: number | null;
    roi: number | null; // net_pnl_usd / account_value — return on current equity over the scored window; null only when account_value is unknown
    sharpe: number | null;
    sortino: number | null;
    psr: number | null;
    max_drawdown_pct: number | null;
    win_rate: number | null;
    total_trades: number;
    avg_hold_seconds: number | null;
    /** Weekly trade average = `scores.tradesPerDayAvg × 7` — the "Frequency"
     *  column. Null when the wallet has no scoring row / no active days yet. */
    trades_per_week: number | null;
  };
  primary_asset: string | null;
  /** True iff this wallet is in the curated "best traders" set (passed the
   * eligibility gate AND composite >= 70, with ~65 hysteresis). `/browse` shows
   * everything; pass `curatedOnly: true` to restrict. */
  curated: boolean;
  /** True iff this wallet is in the current "winners" section = HL's top-10 by
   * 7d ROI passing the noise filter (also the live-WS subscription set). */
  winner: boolean;
  /** 1..10 position by HL 7d ROI when `winner`; null otherwise. Display order of
   * the winners section is by `composite_score`, not this. */
  winner_rank: number | null;
  /**
   * Last-traded time as of the last scoring run (`scores.lastTradeAt`) — the
   * same tier as every other column in this card. The trader profile page
   * shows the fresher *live* value (`leader_cache.lastTradeMs` / latest fill).
   */
  last_active_at: string | null;
  score_computed_at: string | null;
}

export interface BrowseFilters {
  /** Filter by "Profile" archetype tag value (`wallet_tags.tag_type='profile'`). */
  profileTag?: string | undefined;
  /** Filter by heat tag value (`hot` / `steady` / `cooling`). */
  heatTag?: string | undefined;
  minScore?: number | undefined;
  search?: string | undefined;
  /** When true, restrict to the curated "best traders" set (`wallets.curated`). */
  curatedOnly?: boolean | undefined;
  /**
   * When true, restrict to the winner set (`wallets.winner`). The home-page
   * winners strip passes `winnersOnly: true` with `sort: 'composite_score'` —
   * that's the HL-7d-ROI-top-10 set, displayed ranked by our composite.
   */
  winnersOnly?: boolean | undefined;
}

export interface BrowseResult {
  leaders: LeaderCard[];
  total: number;
}

export async function listLeaders(args: {
  filters: BrowseFilters;
  sort: 'composite_score' | 'pnl' | 'equity' | 'frequency';
  page: number;
  limit: number;
}): Promise<BrowseResult> {
  const { filters, sort, page, limit } = args;
  const offset = (page - 1) * limit;

  const baseFilters = [
    eq(wallets.isAgent, false),
    isNotNull(wallets.compositeScore),
    // Listing floor: only wallets with real skin in the game (≥ $25K equity).
    sql`${wallets.accountValue} >= ${MIN_ACCOUNT_VALUE_USD}`,
  ];

  if (filters.minScore !== undefined) {
    baseFilters.push(gte(wallets.compositeScore, filters.minScore));
  }

  if (filters.curatedOnly) {
    baseFilters.push(eq(wallets.curated, true));
  }

  if (filters.winnersOnly) {
    baseFilters.push(eq(wallets.winner, true));
  }

  if (filters.search) {
    baseFilters.push(sql`${wallets.address} ilike ${'%' + filters.search.toLowerCase() + '%'}`);
  }

  // Tag filters require an EXISTS subquery against wallet_tags.
  const tagFilters: ReturnType<typeof sql>[] = [];
  const tagPairs = [
    { type: 'profile', value: filters.profileTag },
    { type: 'heat', value: filters.heatTag },
  ];
  for (const { type, value } of tagPairs) {
    if (value) {
      tagFilters.push(
        sql`exists (select 1 from ${walletTags} t where t.address = ${wallets.address} and t.tag_type = ${type} and t.tag_value = ${value})`,
      );
    }
  }

  const whereClause = and(...baseFilters, ...tagFilters);

  // `frequency` sorts by typical trades-per-day (weekly avg is ×7 — same
  // ordering); `pnl` by net PnL; `equity` by current account value; default by
  // composite.
  const orderColumn =
    sort === 'pnl'
      ? scores.netPnlUsd
      : sort === 'equity'
        ? wallets.accountValue
        : sort === 'frequency'
          ? scores.tradesPerDayAvg
          : wallets.compositeScore;

  const rows = await db()
    .select({
      address: wallets.address,
      composite_score: wallets.compositeScore,
      primary_tag: wallets.primaryTag,
      curated: wallets.curated,
      winner: wallets.winner,
      winner_rank: wallets.winnerRank,
      total_pnl_usd: scores.netPnlUsd,
      total_volume_usd: scores.totalVolumeUsd,
      account_value: wallets.accountValue,
      sharpe: scores.sharpe,
      sortino: scores.sortino,
      psr: scores.psr,
      max_drawdown_pct: scores.maxDrawdownPct,
      win_rate: scores.winRate,
      total_trades: scores.totalTrades,
      avg_hold_seconds: scores.avgHoldSeconds,
      trades_per_day_avg: scores.tradesPerDayAvg,
      primary_asset: scores.primaryAsset,
      last_active_at: scores.lastTradeAt,
      score_computed_at: scores.computedAt,
    })
    .from(wallets)
    .leftJoin(scores, eq(scores.address, wallets.address))
    .where(whereClause)
    .orderBy(desc(orderColumn))
    .limit(limit)
    .offset(offset);

  const totalRow = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(wallets)
    .where(whereClause);

  // Look up secondary tags in a single query for the fetched leaders.
  const addresses = rows.map((r) => r.address);
  const secondaryByAddress = new Map<string, string[]>();
  if (addresses.length > 0) {
    const tagRows = await db()
      .select({
        address: walletTags.address,
        tagType: walletTags.tagType,
        tagValue: walletTags.tagValue,
      })
      .from(walletTags)
      .where(inArray(walletTags.address, addresses));
    for (const t of tagRows) {
      const arr = secondaryByAddress.get(t.address) ?? [];
      // `profile` is surfaced via `primary_tag`; everything else (heat/size) is
      // a "<type>:<value>" secondary tag.
      if (t.tagType !== 'profile') arr.push(`${t.tagType}:${t.tagValue}`);
      secondaryByAddress.set(t.address, arr);
    }
  }

  const leaders: LeaderCard[] = rows.map((r) => ({
    address: r.address,
    composite_score: r.composite_score,
    account_value: numOrNull(r.account_value),
    primary_tag: r.primary_tag,
    secondary_tags: secondaryByAddress.get(r.address) ?? [],
    metrics: {
      total_pnl_usd: numOrNull(r.total_pnl_usd),
      total_volume_usd: numOrNull(r.total_volume_usd),
      roi: roiFromEquity(numOrNull(r.total_pnl_usd), numOrNull(r.account_value)),
      sharpe: numOrNull(r.sharpe),
      sortino: numOrNull(r.sortino),
      psr: numOrNull(r.psr),
      max_drawdown_pct: numOrNull(r.max_drawdown_pct),
      win_rate: numOrNull(r.win_rate),
      total_trades: r.total_trades ?? 0,
      avg_hold_seconds: r.avg_hold_seconds,
      trades_per_week: tradesPerWeek(numOrNull(r.trades_per_day_avg)),
    },
    primary_asset: r.primary_asset,
    curated: r.curated,
    winner: r.winner,
    winner_rank: r.winner_rank,
    last_active_at: r.last_active_at?.toISOString() ?? null,
    score_computed_at: r.score_computed_at?.toISOString() ?? null,
  }));

  return { leaders, total: totalRow[0]?.count ?? 0 };
}

/** Return on current equity over the scored window: net_pnl_usd / account_value.
 *  One definition for the leaderboard ROI column; null only when account_value
 *  is unknown (rare). */
function roiFromEquity(netPnlUsd: number | null, accountValueUsd: number | null): number | null {
  if (netPnlUsd === null || accountValueUsd === null || accountValueUsd <= 0) return null;
  return netPnlUsd / accountValueUsd;
}

/** Weekly trade average from the per-active-day rate. The canonical cadence
 *  quantity is `scores.tradesPerDayAvg`; the weekly figure is a pure ×7. */
function tradesPerWeek(tradesPerDayAvg: number | null): number | null {
  if (tradesPerDayAvg === null) return null;
  return tradesPerDayAvg * 7;
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
