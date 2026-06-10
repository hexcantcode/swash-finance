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
  /** Heat tag (`hot` / `steady` / `cooling`) parsed from the API's
   *  `secondary_tags`. Cards show a "Hot" chip only for `hot`. */
  heat: 'hot' | 'steady' | 'cooling' | null;
  account_value: number | null;
  /** 30D realized PnL from HL's leaderboard snapshot — the headline on
   *  the trader card. Distinct from the scored-window net PnL surfaced
   *  via `LeaderCard.metrics.total_pnl_usd`, which mobile no longer
   *  shows. */
  pnl_30d_usd: number | null;
  roi: number | null;
  win_rate: number | null;
  sharpe: number | null;
  primary_asset: string | null;
  alfa_coin: string | null;
  holdings: Holdings;
  /** 30-point cumulative realized-PnL trajectory (oldest → newest);
   *  always 30 elements, zeros when the wallet has no 30D activity. */
  pnl_curve_30d: number[];
  /** `'equity'` when ≥60% of 30D |closed_pnl| came from stocks/indices;
   *  `'crypto'` otherwise. Drives the focus filter strip on /traders. */
  asset_focus: 'equity' | 'crypto';
  /** ISO timestamp of the last trade as of the last scoring run. Used
   *  for the relative-time pip on the card ("3D AGO"). */
  last_active_at: string | null;
  winner: boolean;
  winner_rank: number | null;
}

interface RawLeaderCard {
  address: string;
  score: number | null;
  primary_tag: string | null;
  /** Non-profile tags as `"<type>:<value>"` strings (heat/size). */
  secondary_tags?: string[];
  account_value: number | null;
  metrics: {
    total_pnl_usd: number | null;
    pnl_30d_usd: number | null;
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
  pnl_curve_30d: number[];
  asset_focus: 'equity' | 'crypto';
  last_active_at: string | null;
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
  focus?: 'equity' | 'crypto';
  page?: number;
  limit?: number;
}

export async function listLeaders(args: LeaderListArgs = {}): Promise<LeaderListResult> {
  const qs = new URLSearchParams();
  if (args.sort) qs.set('sort', args.sort);
  if (args.search) qs.set('search', args.search);
  if (args.focus) qs.set('focus', args.focus);
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

function parseHeat(secondaryTags: string[] | undefined): LeaderRow['heat'] {
  const raw = secondaryTags?.find((t) => t.startsWith('heat:'))?.slice('heat:'.length);
  return raw === 'hot' || raw === 'steady' || raw === 'cooling' ? raw : null;
}

function toLeaderRow(card: RawLeaderCard): LeaderRow {
  return {
    address: card.address,
    score: card.score,
    primary_tag: card.primary_tag,
    heat: parseHeat(card.secondary_tags),
    account_value: card.account_value,
    pnl_30d_usd: card.metrics.pnl_30d_usd,
    roi: card.metrics.roi,
    win_rate: card.metrics.win_rate,
    sharpe: card.metrics.sharpe,
    primary_asset: card.primary_asset,
    alfa_coin: card.alfa_coin,
    holdings: card.holdings,
    pnl_curve_30d: card.pnl_curve_30d,
    asset_focus: card.asset_focus,
    last_active_at: card.last_active_at,
    winner: card.winner,
    winner_rank: card.winner_rank,
  };
}

// Re-export so callers that type API ok/err can use the same vocabulary.
export type { ApiOk };
