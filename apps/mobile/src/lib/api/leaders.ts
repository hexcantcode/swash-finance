/*
 * /api/leaders client.
 *
 * The canonical shape (`LeaderCard`) lives in apps/web's
 * src/lib/server/queries/leaders.ts. Mobile defines a narrower view-model
 * (`LeaderRow`) that surfaces only what the list UI shows; the mapper here
 * is the only place that knows the full API shape, so the rest of mobile
 * never touches fields it doesn't display.
 */

import { apiGet, type ApiOk } from './client';

export type LeaderSort = 'score' | 'pnl' | 'equity' | 'frequency';

/** Currently-open positions snapshot — top by notional + total count.
 *  Mirrors HoldingsByAddress in apps/web/.../queries/holdings.ts. */
export interface Holding {
  coin: string;
  notional_usd: number | null;
  side: 'long' | 'short' | null;
}

export interface Holdings {
  top: Holding[];
  total: number;
}

/** Mobile-only view of a leader row. Subset of apps/web's `LeaderCard`. */
export interface LeaderRow {
  address: string;
  score: number | null;
  primary_tag: string | null;
  account_value: number | null;
  total_pnl_usd: number | null;
  roi: number | null;
  win_rate: number | null;
  sharpe: number | null;
  primary_asset: string | null;
  alfa_coin: string | null;
  holdings: Holdings;
  winner: boolean;
  winner_rank: number | null;
}

interface RawLeaderCard {
  address: string;
  score: number | null;
  primary_tag: string | null;
  account_value: number | null;
  metrics: {
    total_pnl_usd: number | null;
    roi: number | null;
    win_rate: number | null;
    sharpe: number | null;
    sortino: number | null;
    psr: number | null;
    max_drawdown_pct: number | null;
    total_trades: number;
    avg_hold_seconds: number | null;
    trades_per_month: number | null;
  };
  primary_asset: string | null;
  alfa_coin: string | null;
  holdings: Holdings;
  winner: boolean;
  winner_rank: number | null;
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
    score: card.score,
    primary_tag: card.primary_tag,
    account_value: card.account_value,
    total_pnl_usd: card.metrics.total_pnl_usd,
    roi: card.metrics.roi,
    win_rate: card.metrics.win_rate,
    sharpe: card.metrics.sharpe,
    primary_asset: card.primary_asset,
    alfa_coin: card.alfa_coin,
    holdings: card.holdings,
    winner: card.winner,
    winner_rank: card.winner_rank,
  };
}

// Re-export so callers that type API ok/err can use the same vocabulary.
export type { ApiOk };
