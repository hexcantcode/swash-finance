/*
 * /api/leaders client.
 *
 * The canonical shape (`EpLeaderCard`) lives in apps/api's
 * src/lib/server/queries/ep-leaders.ts. The list is now the Extremely
 * Profitable Hyperdash roster — no Swash score, no account value, no 30d
 * curve, no heat/winner tags, no live holdings. The card surfaces all-time
 * cohort PnL, win rate, trade count, and the trader's best ("alfa") coin.
 */

import { apiGet, type ApiOk } from './client';

export type LeaderSort = 'pnl' | 'winrate';

/** A top asset for a trader (coin + volume + pnl), from the EP roster. */
export interface TopAsset {
  coin: string;
  volumeUsd: number;
  pnlUsd: number;
}

/** Mobile view of a leader row — mirrors apps/api's `EpLeaderCard`. */
export interface LeaderRow {
  address: string;
  /** Hyperdash display name — shown over the short address when present. */
  display_name: string | null;
  /** All-time cohort PnL (USD) — the card headline. NOT a 30d figure. */
  pnl_usd: number;
  /** 0–100 (already a percentage). */
  winrate_pct: number;
  total_trades: number;
  /** Trader's best coin by PnL — drives the "alfa coin" chip. Null when the
   *  trader has no top assets. */
  alfa_coin: string | null;
  /** Top 3 assets by PnL. */
  top_assets: TopAsset[];
}

interface RawLeaderCard {
  address: string;
  displayName?: string | null;
  pnlUsd: number;
  winratePct: number;
  totalTrades: number;
  alfaCoin: string | null;
  topAssets: TopAsset[];
}

interface ListLeadersResponse {
  ok: true;
  data: {
    leaders: RawLeaderCard[];
    total: number;
    page: number;
    limit: number;
  };
}

export interface LeaderListResult {
  rows: LeaderRow[];
  total: number;
  page: number;
  limit: number;
}

export interface LeaderListArgs {
  sort?: LeaderSort;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listLeaders(args: LeaderListArgs = {}): Promise<LeaderListResult> {
  const qs = new URLSearchParams();
  if (args.sort) qs.set('sort', args.sort);
  if (args.search) qs.set('search', args.search);
  if (args.page) qs.set('page', String(args.page));
  if (args.limit) qs.set('limit', String(args.limit));

  const path = `/api/leaders${qs.toString() ? `?${qs.toString()}` : ''}`;
  const body = await apiGet<ListLeadersResponse>(path);
  if (!body.ok) {
    throw new Error('Leaderboard request returned ok:false');
  }
  return {
    rows: body.data.leaders.map(toLeaderRow),
    total: body.data.total,
    page: body.data.page,
    limit: body.data.limit,
  };
}

function toLeaderRow(card: RawLeaderCard): LeaderRow {
  return {
    address: card.address,
    display_name: card.displayName ?? null,
    pnl_usd: card.pnlUsd,
    winrate_pct: card.winratePct,
    total_trades: card.totalTrades,
    alfa_coin: card.alfaCoin,
    top_assets: card.topAssets,
  };
}

// Re-export so callers that type API ok/err can use the same vocabulary.
export type { ApiOk };
