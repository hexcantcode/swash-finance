/*
 * /api/leaders/top client — top traders from the Extremely Profitable roster.
 * Powers the home-screen Top Traders strip. The EP roster is all-time only, so
 * the `window` is no longer a real filter (every window returns the same
 * all-time top-PnL slice); it's kept for the UI's tab state. Canonical query:
 * apps/api's queries/ep-leaders.ts (`listEpTopTraders`).
 */

import { apiGet } from './client';
import type { TopAsset } from './leaders';

export type LeaderWindow = '1d' | '7d' | '30d';

export interface TopTrader {
  address: string;
  /** Hyperdash display name — shown over the short address when present. */
  display_name?: string | null;
  /** All-time cohort PnL (USD). NOT a windowed figure. */
  pnl_usd: number;
  /** 0–100 (already a percentage). */
  winrate_pct: number;
  total_trades: number;
  /** Trader's best coin by PnL. Null when the trader has no top assets. */
  alfa_coin: string | null;
  top_assets: TopAsset[];
}

interface RawTopTrader {
  address: string;
  displayName?: string | null;
  pnlUsd: number;
  winratePct: number;
  totalTrades: number;
  alfaCoin: string | null;
  topAssets: TopAsset[];
}

interface TopTradersResponse {
  ok: true;
  data: { traders: RawTopTrader[]; window: LeaderWindow };
}

export async function listTopTraders(window: LeaderWindow, limit = 12): Promise<TopTrader[]> {
  const body = await apiGet<TopTradersResponse>(
    `/api/leaders/top?window=${window}&limit=${limit}`,
  );
  if (!body.ok) throw new Error('Top traders request returned ok:false');
  return body.data.traders.map((t) => ({
    address: t.address,
    display_name: t.displayName ?? null,
    pnl_usd: t.pnlUsd,
    winrate_pct: t.winratePct,
    total_trades: t.totalTrades,
    alfa_coin: t.alfaCoin,
    top_assets: t.topAssets,
  }));
}
