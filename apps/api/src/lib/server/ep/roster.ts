/**
 * The Extremely Profitable cohort's leading traders — the single shared wallet
 * roster behind the feed's Trades, Positions and per-trader detail. Consistent
 * with the Sentiment tab, which reads the same cohort's aggregate positioning.
 *
 * Hyperdash's `exploreTraders` sorted by all-time PnL surfaces the +$1M cohort
 * (every top row reports `pnlCohort: "Extremely Profitable"`); we take the top N
 * and reuse their addresses for the per-trader fan-outs. Source: Hyperdash
 * public GraphQL. See the `.claude/skills/hyperdash-top-traders` skill.
 */

import { hdFetch, ttlCache } from './shared.js';

/** How many top-PnL traders to track. `exploreTraders` caps pageSize at 100. */
const ROSTER_SIZE = 100;

const QUERY = `query ExploreTraders($timeframe: TraderTimeframe!, $sortBy: TraderSortInput, $pageSize: Int) {
  exploreTraders(page: 1, pageSize: $pageSize, timeframe: $timeframe, sortBy: $sortBy) {
    data {
      address displayName copyScore pnl pnlCohort
      winrate totalTrades sharpe drawdown
      topAssets { coin volume pnl }
    }
  }
}`;

export interface EpTopAsset {
  coin: string;
  volumeUsd: number;
  pnlUsd: number;
}

export interface EpTrader {
  address: string;
  displayName: string | null;
  copyScore: number;
  pnlUsd: number;
  /** 0–100 (already a percentage). */
  winratePct: number;
  totalTrades: number;
  sharpe: number;
  drawdown: number;
  topAssets: EpTopAsset[];
}

// The cohort membership moves slowly (it's all-time PnL); cache hard so the
// per-trader fan-outs share one roster fetch.
const cache = ttlCache<EpTrader[]>(600_000);

export async function getEpRoster(): Promise<EpTrader[]> {
  const fresh = cache.get();
  if (fresh) return fresh;
  try {
    const data = await hdFetch<{
      exploreTraders?: {
        data?: {
          address: string;
          displayName: string | null;
          copyScore: number;
          pnl: number | string | null;
          winrate: number | string | null;
          totalTrades: number | string | null;
          sharpe: number | string | null;
          drawdown: number | string | null;
          topAssets: { coin: string; volume: number | string | null; pnl: number | string | null }[] | null;
        }[];
      };
    }>('ExploreTraders', QUERY, {
      timeframe: 'all',
      sortBy: { field: 'pnl', order: 'desc' },
      pageSize: ROSTER_SIZE,
    });
    const rows = data?.exploreTraders?.data ?? [];
    const roster: EpTrader[] = rows.map((r) => ({
      address: r.address,
      displayName: r.displayName,
      copyScore: r.copyScore ?? 0,
      pnlUsd: Number(r.pnl) || 0,
      winratePct: Number(r.winrate) || 0,
      totalTrades: Number(r.totalTrades) || 0,
      sharpe: Number(r.sharpe) || 0,
      drawdown: Number(r.drawdown) || 0,
      topAssets: (r.topAssets ?? []).map((a) => ({
        coin: a.coin,
        volumeUsd: Number(a.volume) || 0,
        pnlUsd: Number(a.pnl) || 0,
      })),
    }));
    if (roster.length === 0) return cache.last() ?? [];
    return cache.set(roster);
  } catch {
    return cache.last() ?? [];
  }
}
