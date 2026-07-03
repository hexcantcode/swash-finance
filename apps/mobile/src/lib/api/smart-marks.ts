/*
 * Smart-money marks for the asset chart: EP-cohort closed trades (dot
 * markers) and per-side open-position entry levels (dashed lines), from
 * /api/assets/[coin]/smart-marks. All aggregation (notional-weighted avg
 * entry, counts) happens server-side — this module only ferries the shape.
 */

import { apiGet } from './client';

export interface SmartMarkTrade {
  address: string;
  displayName: string | null;
  /** 'Long' | 'Short' as Hyperdash reports it. */
  direction: string;
  szBase: number;
  notionalUsd: number;
  entryPxUsd: number;
  exitPxUsd: number;
  netPnlUsd: number;
  openedAtMs: number | null;
  closedAtMs: number;
}

export interface SmartEntryLevel {
  count: number;
  /** Notional-weighted average entry price (computed server-side). */
  avgPxUsd: number;
  notionalUsd: number;
}

export interface SmartMarks {
  trades: SmartMarkTrade[];
  entryLevels: { long: SmartEntryLevel | null; short: SmartEntryLevel | null };
}

interface SmartMarksResponse extends SmartMarks {
  ok: true;
}

export async function getSmartMarks(coin: string): Promise<SmartMarks> {
  const body = await apiGet<SmartMarksResponse>(
    `/api/assets/${encodeURIComponent(coin)}/smart-marks`,
  );
  if (!body.ok) throw new Error('Smart-marks request returned ok:false');
  return { trades: body.trades, entryLevels: body.entryLevels };
}
