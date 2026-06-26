/*
 * /api/leaders/[address] client. Mirrors the rich detail shape `getLeaderDetail`
 * returns in apps/web. The mobile detail view only renders a subset, but we
 * type the full surface so the mapper has a complete contract — adding new
 * fields to the API later is then a typing-only change here.
 */

import { apiGet, apiUrl } from './client';

/** Currently-open positions snapshot — top by notional + total count. Local
 *  to the detail client (Phase C2 still owns this surface); the list client no
 *  longer carries holdings. */
interface Holding {
  coin: string;
  notional_usd: number | null;
  side: 'long' | 'short' | null;
}
interface Holdings {
  top: Holding[];
  total: number;
}

export interface RecentFill {
  tid: number;
  block_time_ms: number;
  coin: string;
  side: 'A' | 'B' | string;
  px: number | null;
  sz: number | null;
  notional: number | null;
  closed_pnl: number | null;
  leverage?: number | null;
}

export interface OpenPosition {
  coin: string;
  side: 'long' | 'short' | null;
  szBase: number | null;
  entryPxUsd: number | null;
  notionalUsd: number | null;
  unrealizedPnlUsd: number | null;
  returnOnEquity: number | null;
  leverage: number | null;
}

export interface ScoringSnapshot {
  net_pnl_usd: number | null;
  net_pnl_pct: number | null;
  total_trades: number;
  active_days: number | null;
  total_volume_usd: number | null;
  sharpe: number | null;
  sortino: number | null;
  psr: number | null;
  win_rate: number | null;
  max_drawdown_pct: number | null;
  avg_hold_seconds: number | null;
  trades_per_day_avg: number | null;
  decay_flag: string | null;
  computed_at: string | null;
}

export interface LeaderDetail {
  address: string;
  /** HL user-set display name — shown over the short address when present. */
  display_name?: string | null;
  score: number | null;
  primary_tag: string | null;
  tags: { type: string; value: string }[];
  scoring: ScoringSnapshot | null;
  recent_fills: RecentFill[];
  open_positions: OpenPosition[];
  account_value: number | null;
  leverage: number | null;
  margin_used: number | null;
  last_seen_at: string | null;
  last_trade_at: string | null;
  total_volume_usd: number | null;
  /** Cumulative realized PnL (USD) per day for the last ~90 days as of
   *  the last scoring run. `ts` is epoch-ms at UTC midnight of the day;
   *  `value` is the running total — same shape as the canonical
   *  `LeaderDetail.equity_curve` in apps/web. Drives the equity chart
   *  on the profile page. Empty when no fills land in the window. */
  equity_curve: { ts: number; value: number }[];
  /** Top + total snapshot mirrored from /api/holdings shape for convenience. */
  holdings?: Holdings;
  /** Lifetime volume share per coin, descending. Drives the "home market"
   *  bio clause + chip (dominant when the top share ≥ 0.4). */
  primary_asset_breakdown?: { coin: string; volume_usd: number; share: number }[];
}

interface LeaderDetailResponse {
  ok: true;
  data: LeaderDetail;
}

export async function getLeaderDetail(address: string): Promise<LeaderDetail> {
  const body = await apiGet<LeaderDetailResponse>(
    `/api/leaders/${encodeURIComponent(address)}`,
  );
  if (!body.ok) throw new Error('Leader detail request returned ok:false');
  return body.data;
}

/** The volatile slice of a trader's state — the fields that change moment to
 *  moment. Subset of LeaderDetail; pushed live over SSE. */
export interface LiveSlice {
  open_positions: OpenPosition[];
  recent_fills: RecentFill[];
}

/** Subscribe to a trader's live positions + fills via SSE
 *  (`/api/stream/trader/[address]`). Calls `onSlice` with the snapshot on
 *  connect, then again whenever positions/fills change. EventSource
 *  auto-reconnects. Returns a close fn. Browser-only. */
export function subscribeLiveSlice(
  address: string,
  onSlice: (slice: LiveSlice) => void,
): () => void {
  const es = new EventSource(apiUrl(`/api/stream/trader/${encodeURIComponent(address)}`));
  es.onmessage = (ev) => {
    let body: unknown;
    try {
      body = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return;
    }
    const slice = body as Partial<LiveSlice> | null;
    if (slice && Array.isArray(slice.open_positions) && Array.isArray(slice.recent_fills)) {
      onSlice({ open_positions: slice.open_positions, recent_fills: slice.recent_fills });
    }
  };
  return () => {
    es.onmessage = null;
    try {
      es.close();
    } catch {
      /* ignore */
    }
  };
}
