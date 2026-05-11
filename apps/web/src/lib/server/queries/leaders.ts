import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { scores, walletTags, wallets } from '@copytrade/db';
import { db } from '../db.js';

export interface LeaderCard {
  address: string;
  composite_score: number | null;
  primary_tag: string | null;
  secondary_tags: string[];
  metrics: {
    total_pnl_usd: number | null;
    total_volume_usd: number | null;
    roi: number | null; // net_pnl / total_deposits, null when deposits=0
    sharpe: number | null;
    psr: number | null;
    max_drawdown_pct: number | null;
    win_rate: number | null;
    total_trades: number;
    avg_hold_seconds: number | null;
  };
  primary_asset: string | null;
  last_active_at: string | null;
  score_computed_at: string | null;
}

export interface BrowseFilters {
  mainTag?: string | undefined;
  assetTag?: string | undefined;
  riskTag?: string | undefined;
  heatTag?: string | undefined;
  cadenceTag?: string | undefined;
  minScore?: number | undefined;
  search?: string | undefined;
}

export interface BrowseResult {
  leaders: LeaderCard[];
  total: number;
}

export async function listLeaders(args: {
  filters: BrowseFilters;
  sort: 'composite_score' | 'roi' | 'last_active';
  page: number;
  limit: number;
}): Promise<BrowseResult> {
  const { filters, sort, page, limit } = args;
  const offset = (page - 1) * limit;

  const baseFilters = [
    eq(wallets.isAgent, false),
    isNotNull(wallets.compositeScore),
  ];

  if (filters.minScore !== undefined) {
    baseFilters.push(gte(wallets.compositeScore, filters.minScore));
  }

  if (filters.search) {
    baseFilters.push(sql`${wallets.address} ilike ${'%' + filters.search.toLowerCase() + '%'}`);
  }

  // Tag filters require an EXISTS subquery against wallet_tags.
  const tagFilters: ReturnType<typeof sql>[] = [];
  const tagPairs = [
    { type: 'main', value: filters.mainTag },
    { type: 'asset', value: filters.assetTag },
    { type: 'risk', value: filters.riskTag },
    { type: 'heat', value: filters.heatTag },
    { type: 'cadence', value: filters.cadenceTag },
  ];
  for (const { type, value } of tagPairs) {
    if (value) {
      tagFilters.push(
        sql`exists (select 1 from ${walletTags} t where t.address = ${wallets.address} and t.tag_type = ${type} and t.tag_value = ${value})`,
      );
    }
  }

  const whereClause = and(...baseFilters, ...tagFilters);

  const orderColumn =
    sort === 'roi'
      ? scores.netPnlPct
      : sort === 'last_active'
        ? wallets.lastSeenAt
        : wallets.compositeScore;

  const rows = await db()
    .select({
      address: wallets.address,
      composite_score: wallets.compositeScore,
      primary_tag: wallets.primaryTag,
      total_pnl_usd: scores.netPnlUsd,
      total_volume_usd: scores.totalVolumeUsd,
      roi: scores.netPnlPct,
      sharpe: scores.sharpe,
      psr: scores.psr,
      max_drawdown_pct: scores.maxDrawdownPct,
      win_rate: scores.winRate,
      total_trades: scores.totalTrades,
      avg_hold_seconds: scores.avgHoldSeconds,
      primary_asset: scores.primaryAsset,
      last_active_at: wallets.lastSeenAt,
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
      if (t.tagType !== 'main') arr.push(`${t.tagType}:${t.tagValue}`);
      secondaryByAddress.set(t.address, arr);
    }
  }

  const leaders: LeaderCard[] = rows.map((r) => ({
    address: r.address,
    composite_score: r.composite_score,
    primary_tag: r.primary_tag,
    secondary_tags: secondaryByAddress.get(r.address) ?? [],
    metrics: {
      total_pnl_usd: numOrNull(r.total_pnl_usd),
      total_volume_usd: numOrNull(r.total_volume_usd),
      roi: numOrNull(r.roi),
      sharpe: numOrNull(r.sharpe),
      psr: numOrNull(r.psr),
      max_drawdown_pct: numOrNull(r.max_drawdown_pct),
      win_rate: numOrNull(r.win_rate),
      total_trades: r.total_trades ?? 0,
      avg_hold_seconds: r.avg_hold_seconds,
    },
    primary_asset: r.primary_asset,
    last_active_at: r.last_active_at?.toISOString() ?? null,
    score_computed_at: r.score_computed_at?.toISOString() ?? null,
  }));

  return { leaders, total: totalRow[0]?.count ?? 0 };
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
