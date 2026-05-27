import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { scores, walletTags, wallets } from '@copytrade/db';
import { coinCategory } from '$lib/utils/coin';
import { db } from '../db.js';
import { listBestAssetsByWinRate } from './best-asset.js';
import { listHoldingsByAddress, type HoldingsByAddress } from './holdings.js';

export interface LeaderCard {
  address: string;
  score: number | null;
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
    /** Last-30-day realized PnL (USD) from Hyperliquid's leaderboard
     *  snapshot (`wallets.hl_pnl_30d_usd`). Distinct from `total_pnl_usd`
     *  which is the scored-window net PnL across the full backtest.
     *  Surfaced for the mobile trader card's "PnL 30D" headline. */
    pnl_30d_usd: number | null;
    roi: number | null; // net_pnl_usd / account_value — return on current equity over the scored window; null only when account_value is unknown
    sharpe: number | null;
    sortino: number | null;
    psr: number | null;
    max_drawdown_pct: number | null;
    win_rate: number | null;
    total_trades: number;
    avg_hold_seconds: number | null;
    /** Monthly trade average = `scores.tradesPerDayAvg × 30` — the
     *  "Frequency" column. Null when the wallet has no scoring row / no
     *  active days yet. */
    trades_per_month: number | null;
  };
  primary_asset: string | null;
  /** "Alfa" — coin this trader has the highest fill-level win rate on with
   *  ≥ 5 trades on that coin. Null when no coin clears the sample floor.
   *  Distinct from `primary_asset` (most-traded by volume): same trader can
   *  have BTC as primary_asset and SOL as alfa_coin. */
  alfa_coin: string | null;
  /** Currently-open positions snapshot — top 3 by notional + total count.
   *  Drives the Holdings column. Empty top + total=0 when the wallet has
   *  no open positions in `leader_cache`. */
  holdings: HoldingsByAddress;
  /** 30-point cumulative realized PnL trajectory over the last 30 days
   *  (USD). Day 0 = 29 days ago, day 29 = today. Each value is the
   *  running total of `closed_pnl + funding_usdc` up to and including
   *  that day. Days with no activity carry the previous value forward.
   *  Always 30 elements; zeros when the wallet has no fills in the
   *  window. Drives the mobile trader card sparkline. */
  pnl_curve_30d: number[];
  /** Trader's primary asset class over the last 30 days, by share of
   *  |closed_pnl|: `'equity'` when ≥60% of absolute realized PnL came
   *  from stocks/indices, `'crypto'` otherwise (default + fallback when
   *  the wallet has no 30D activity). Drives the mobile focus filter
   *  on /traders. `index` category folds into `equity`. */
  asset_focus: 'equity' | 'crypto';
  /** True iff this wallet is in the curated "best traders" set (passed the
   * eligibility gate AND composite >= 70, with ~65 hysteresis). `/browse` shows
   * everything; pass `curatedOnly: true` to restrict. */
  curated: boolean;
  /** True iff this wallet is in the current "winners" section = HL's top-10 by
   * 7d ROI passing the noise filter (also the live-WS subscription set). */
  winner: boolean;
  /** 1..10 position by HL 7d ROI when `winner`; null otherwise. Display order of
   * the winners section is by `score`, not this. */
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
   * winners strip passes `winnersOnly: true` with `sort: 'score'` —
   * that's the HL-7d-ROI-top-10 set, displayed ranked by our composite.
   */
  winnersOnly?: boolean | undefined;
  /**
   * Restrict to traders whose 30D realized PnL is dominated (≥60%) by
   * the named asset class. See `LeaderCard.asset_focus`. Omitted = no
   * restriction.
   */
  focus?: 'equity' | 'crypto' | undefined;
}

export interface BrowseResult {
  leaders: LeaderCard[];
  total: number;
}

export async function listLeaders(args: {
  filters: BrowseFilters;
  sort: 'score' | 'pnl' | 'equity' | 'frequency';
  page: number;
  limit: number;
}): Promise<BrowseResult> {
  const { filters, sort, page, limit } = args;
  const offset = (page - 1) * limit;

  // The `tracked_wallets` view enforces is_agent=false, score IS NOT NULL,
  // live-equity floor (COALESCE with hysteresis), and the scoring-quality
  // gates (decay_flag, total_trades, profit_factor, max_drawdown). INNER
  // JOIN against it replaces those filters in one expression — single
  // source of truth for "wallets we follow + present." See
  // docs/plans/2026-05-17-tracked-wallets-view-design.md.
  const baseFilters: ReturnType<typeof sql>[] = [
    sql`exists (select 1 from tracked_wallets tw where tw.address = ${wallets.address})`,
  ];

  if (filters.minScore !== undefined) {
    baseFilters.push(sql`${gte(wallets.score, filters.minScore)}`);
  }

  if (filters.winnersOnly) {
    baseFilters.push(sql`${eq(wallets.winner, true)}`);
  }

  if (filters.search) {
    baseFilters.push(sql`${wallets.address} ilike ${'%' + filters.search.toLowerCase() + '%'}`);
  }

  // Compute per-wallet asset-class focus from the last 30 days of realized
  // PnL across the tracked set. Always runs (the value is surfaced on every
  // returned card); when `filters.focus` is set we also restrict the main
  // SELECT to addresses whose classification matches. Scoping to
  // `tracked_wallets` keeps the aggregation bounded — the leaderboard is a
  // few hundred wallets, not the whole fills table.
  const focusByAddress = await classifyAssetFocusByAddress();
  if (filters.focus) {
    const matching = [...focusByAddress.entries()]
      .filter(([, f]) => f === filters.focus)
      .map(([a]) => a);
    if (matching.length === 0) {
      // No wallet passes the focus filter — short-circuit before hitting
      // any other table.
      return { leaders: [], total: 0 };
    }
    baseFilters.push(sql`${inArray(wallets.address, matching)}`);
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
          : wallets.score;

  const rows = await db()
    .select({
      address: wallets.address,
      score: wallets.score,
      primary_tag: wallets.primaryTag,
      curated: wallets.curated,
      winner: wallets.winner,
      winner_rank: wallets.winnerRank,
      total_pnl_usd: scores.netPnlUsd,
      total_volume_usd: scores.totalVolumeUsd,
      pnl_30d_usd: wallets.hlPnl30dUsd,
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
  const curvePromise = pnlCurve30dByAddress(addresses);
  const [, alfaByAddress, holdingsByAddress] = await Promise.all([
    (async () => {
      if (addresses.length === 0) return;
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
    })(),
    listBestAssetsByWinRate(addresses),
    listHoldingsByAddress(addresses),
  ]);
  const curveByAddress = await curvePromise;

  const leaders: LeaderCard[] = rows.map((r) => ({
    address: r.address,
    score: r.score,
    account_value: numOrNull(r.account_value),
    primary_tag: r.primary_tag,
    secondary_tags: secondaryByAddress.get(r.address) ?? [],
    metrics: {
      total_pnl_usd: numOrNull(r.total_pnl_usd),
      total_volume_usd: numOrNull(r.total_volume_usd),
      pnl_30d_usd: numOrNull(r.pnl_30d_usd),
      roi: roiFromEquity(numOrNull(r.total_pnl_usd), numOrNull(r.account_value)),
      sharpe: numOrNull(r.sharpe),
      sortino: numOrNull(r.sortino),
      psr: numOrNull(r.psr),
      max_drawdown_pct: numOrNull(r.max_drawdown_pct),
      win_rate: numOrNull(r.win_rate),
      total_trades: r.total_trades ?? 0,
      avg_hold_seconds: r.avg_hold_seconds,
      trades_per_month: tradesPerMonth(numOrNull(r.trades_per_day_avg)),
    },
    primary_asset: r.primary_asset,
    alfa_coin: alfaByAddress.get(r.address) ?? null,
    holdings: holdingsByAddress.get(r.address) ?? { top: [], total: 0 },
    pnl_curve_30d: curveByAddress.get(r.address) ?? new Array(30).fill(0),
    asset_focus: focusByAddress.get(r.address) ?? 'crypto',
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

/** Monthly trade average from the per-active-day rate. The canonical cadence
 *  quantity is `scores.tradesPerDayAvg`; the monthly figure is a pure ×30. */
function tradesPerMonth(tradesPerDayAvg: number | null): number | null {
  if (tradesPerDayAvg === null) return null;
  return tradesPerDayAvg * 30;
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify every tracked wallet as `equity`- or `crypto`-focused by the
 * 30D realized-PnL share across asset classes. A wallet is `equity` when
 * ≥60% of its absolute realized PnL came from stocks/indices (folded
 * together — same as the analytics breakdown); else `crypto`. Wallets
 * with no 30D activity fall back to `crypto` (the platform majority).
 *
 * Implementation: aggregate `|closed_pnl|` per `(address, coin)` in SQL,
 * fold to category in TS using the canonical `coinCategory` helper.
 * Keeps the index/dex symbol list in one place (`utils/coin.ts`) rather
 * than duplicating it inside the SQL.
 */
async function classifyAssetFocusByAddress(): Promise<Map<string, 'equity' | 'crypto'>> {
  const startMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rows = await db().execute<{
    user_address: string;
    coin: string;
    abs_pnl: string;
  }>(sql`
    SELECT
      f.user_address,
      f.coin,
      SUM(ABS(f.closed_pnl::numeric))::text AS abs_pnl
    FROM fills f
    WHERE f.block_time_ms >= ${startMs}
      AND EXISTS (
        SELECT 1 FROM tracked_wallets tw WHERE tw.address = f.user_address
      )
    GROUP BY f.user_address, f.coin
  `);

  const perWallet = new Map<string, { stocks: number; crypto: number }>();
  for (const r of rows.rows) {
    const colonIdx = r.coin.indexOf(':');
    const dex = colonIdx === -1 ? null : r.coin.slice(0, colonIdx);
    const cat3 = coinCategory(r.coin, dex);
    const cat: 'stocks' | 'crypto' = cat3 === 'crypto' ? 'crypto' : 'stocks';
    const abs = Number.parseFloat(r.abs_pnl);
    if (!Number.isFinite(abs)) continue;
    const entry = perWallet.get(r.user_address) ?? { stocks: 0, crypto: 0 };
    entry[cat] += abs;
    perWallet.set(r.user_address, entry);
  }

  const out = new Map<string, 'equity' | 'crypto'>();
  for (const [address, { stocks, crypto }] of perWallet) {
    const total = stocks + crypto;
    out.set(address, total > 0 && stocks / total >= 0.6 ? 'equity' : 'crypto');
  }
  return out;
}

/**
 * Build a 30-point cumulative realized-PnL trajectory per address from
 * `fills.closed_pnl + fundings.usdc` over the last 30 days. Days with no
 * activity carry the prior cumulative forward (the array is monotone in
 * the "no fills" stretches). Output day 0 is 29 days ago; day 29 is the
 * 24h window ending now.
 *
 * NB: this is a *realized* trajectory, not literal account equity — it
 * doesn't include mark-to-market on open positions. See the design doc
 * for the trade-off (`docs/plans/2026-05-27-mobile-trader-card-redesign-design.md`).
 */
async function pnlCurve30dByAddress(addresses: string[]): Promise<Map<string, number[]>> {
  const DAYS = 30;
  if (addresses.length === 0) return new Map();
  const startMs = Date.now() - DAYS * 24 * 60 * 60 * 1000;

  // `node-postgres` won't auto-cast a JS array for `= ANY($n)`; build an
  // `IN (...)` list via `sql.join` (same pattern as `holdings.ts` /
  // `analytics.ts`).
  const addrList = sql.join(
    addresses.map((a) => sql`${a}`),
    sql`, `,
  );

  const rows = await db().execute<{
    user_address: string;
    day_idx: number;
    net_usd: string;
  }>(sql`
    WITH fills_daily AS (
      SELECT
        user_address,
        FLOOR((block_time_ms - ${startMs}) / 86400000.0)::int AS day_idx,
        SUM(closed_pnl::numeric) AS pnl
      FROM fills
      WHERE user_address IN (${addrList})
        AND block_time_ms >= ${startMs}
      GROUP BY user_address, day_idx
    ),
    fundings_daily AS (
      SELECT
        user_address,
        FLOOR((block_time_ms - ${startMs}) / 86400000.0)::int AS day_idx,
        SUM(usdc::numeric) AS funding_usd
      FROM fundings
      WHERE user_address IN (${addrList})
        AND block_time_ms >= ${startMs}
      GROUP BY user_address, day_idx
    )
    SELECT
      COALESCE(f.user_address, g.user_address) AS user_address,
      COALESCE(f.day_idx, g.day_idx)            AS day_idx,
      (COALESCE(f.pnl, 0) + COALESCE(g.funding_usd, 0))::text AS net_usd
    FROM fills_daily f
    FULL OUTER JOIN fundings_daily g
      ON f.user_address = g.user_address AND f.day_idx = g.day_idx
  `);

  // Bucket daily-net per address into a dense 30-point array (zeros for
  // missing days), then cumulative-sum in place. Forward-fill is a
  // consequence of cumulative-sum on a zero — the running total holds.
  const dailyByAddress = new Map<string, number[]>();
  for (const addr of addresses) dailyByAddress.set(addr, new Array(DAYS).fill(0));
  for (const r of rows.rows) {
    const arr = dailyByAddress.get(r.user_address);
    if (!arr) continue;
    const idx = r.day_idx;
    if (idx < 0 || idx >= DAYS) continue;
    const n = Number.parseFloat(r.net_usd);
    if (Number.isFinite(n)) arr[idx] = (arr[idx] ?? 0) + n;
  }
  const out = new Map<string, number[]>();
  for (const [addr, daily] of dailyByAddress) {
    const cum = new Array<number>(DAYS);
    let running = 0;
    for (let i = 0; i < DAYS; i++) {
      running += daily[i] ?? 0;
      cum[i] = running;
    }
    out.set(addr, cum);
  }
  return out;
}
