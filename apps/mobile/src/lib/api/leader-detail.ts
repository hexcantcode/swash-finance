/*
 * /api/leaders/[address] client — mirrors the `EpTraderDetail` shape the BFF
 * returns from `getEpTraderDetail` (Hyperdash Extremely-Profitable cohort).
 * Open positions, recent completed trades, and a roster `stats` block. No live
 * stream — Hyperdash has no live feed, so the page just renders this snapshot.
 */

import { apiGet } from './client';

export interface EpTraderPosition {
  coin: string;
  side: 'long' | 'short';
  szBase: number;
  notionalUsd: number;
  entryPxUsd: number;
  unrealizedPnlUsd: number;
}

export interface EpTraderTrade {
  coin: string;
  /** 'Long' | 'Short' as Hyperdash reports it. */
  direction: string;
  szBase: number;
  entryPxUsd: number;
  exitPxUsd: number;
  netPnlUsd: number;
  notionalUsd: number;
  closedAtMs: number;
}

export interface EpTopAsset {
  coin: string;
  volumeUsd: number;
  pnlUsd: number;
}

/** Basic stats from the EP roster; null when the address isn't in the roster. */
export interface EpTraderStats {
  pnlUsd: number;
  /** 0–100 (already a percentage). */
  winratePct: number;
  copyScore: number;
  totalTrades: number;
  sharpe: number;
  drawdown: number;
  topAssets: EpTopAsset[];
}

export interface EpTraderDetail {
  address: string;
  displayName: string | null;
  stats: EpTraderStats | null;
  positions: EpTraderPosition[];
  trades: EpTraderTrade[];
}

interface EpTraderDetailResponse {
  ok: true;
  data: EpTraderDetail;
}

export async function getEpTraderDetail(address: string): Promise<EpTraderDetail> {
  const body = await apiGet<EpTraderDetailResponse>(
    `/api/leaders/${encodeURIComponent(address)}`,
  );
  if (!body.ok) throw new Error('Trader detail request returned ok:false');
  return body.data;
}
