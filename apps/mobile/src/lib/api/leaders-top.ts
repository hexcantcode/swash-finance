/*
 * /api/leaders/top client — top tracked traders by HL-reported realized PnL
 * over a rolling window (1d / 7d / 30d). Powers the home-screen Top Traders
 * strip. Canonical query lives in apps/web's queries/weekly-leaders.ts
 * (`listTopTradersByWindow`); this mirrors only the fields the card shows.
 */

import { apiGet } from './client';
import type { Holdings } from './leaders';

export type LeaderWindow = '1d' | '7d' | '30d';

export interface TopTrader {
  address: string;
  /** HL user-set display name — shown over the short address when present. */
  display_name?: string | null;
  primary_tag: string | null;
  score: number | null;
  /** HL-reported realized PnL over the window (USD). */
  pnl_usd: number | null;
  /** HL-reported ROI over the window (signed decimal; 0.05 = +5%). */
  roi: number | null;
  account_value_usd: number | null;
  alfa_coin: string | null;
  holdings: Holdings;
}

interface TopTradersResponse {
  ok: true;
  data: { traders: TopTrader[]; window: LeaderWindow };
}

export async function listTopTraders(window: LeaderWindow, limit = 12): Promise<TopTrader[]> {
  const body = await apiGet<TopTradersResponse>(
    `/api/leaders/top?window=${window}&limit=${limit}`,
  );
  if (!body.ok) throw new Error('Top traders request returned ok:false');
  return body.data.traders;
}
