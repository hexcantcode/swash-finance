/*
 * Single-asset detail. The web app exposes the full market list at
 * /api/assets and per-coin candles at /api/assets/[coin]/candles. There's no
 * dedicated "one asset by coin" endpoint, so mobile reuses the list and
 * picks the row — wasteful in absolute bytes but the list is cached and
 * shared with /assets, so the second call is free.
 */

import { apiGet } from './client';
import type { Asset } from './assets';

export type CandleRange = '1h' | '4h' | '1d' | '7d' | '30d' | 'all';

export const CANDLE_RANGES: { value: CandleRange; label: string }[] = [
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '1M' },
  { value: 'all', label: 'ALL' },
];

export interface Candle {
  /** Open time in ms since epoch. */
  t: number;
  o: number;
  c: number;
  h: number;
  l: number;
  v: number;
}

interface CandlesResponse {
  ok: true;
  range: CandleRange;
  candles: Candle[];
}

export async function getCandles(
  coin: string,
  range: CandleRange,
): Promise<Candle[]> {
  const body = await apiGet<CandlesResponse>(
    `/api/assets/${encodeURIComponent(coin)}/candles?range=${range}`,
  );
  if (!body.ok) throw new Error('Candles request returned ok:false');
  return body.candles;
}

/** Top trader on this coin, by all-time closed PnL. Mirrors the web's
 *  `TopTrader` shape (apps/web .../asset-ranges.ts) — the canonical source. */
export interface TopTrader {
  address: string;
  totalPnlUsd: number;
  /** All-time volume on this coin (Hyperdash topAssets). */
  volumeUsd: number;
  tradeCount: number;
  /** SUM(closed_pnl) / SUM(|sz·px|), decimal; null when no closed notional. */
  roi: number | null;
}

/** A position-open event surfaced in the "Latest trades" tab. `side`: 'B' =
 *  opened long, 'A' = opened short. */
export interface TraderOpen {
  address: string;
  blockTimeMs: number;
  side: 'B' | 'A';
  pxUsd: number;
}

interface TopTradersResponse {
  ok: true;
  topTraders: TopTrader[];
}

interface LatestOpensResponse {
  ok: true;
  latestOpens: TraderOpen[];
}

export async function getTopTraders(
  coin: string,
  limit = 5,
): Promise<TopTrader[]> {
  const body = await apiGet<TopTradersResponse>(
    `/api/assets/${encodeURIComponent(coin)}/top-traders?limit=${limit}`,
  );
  if (!body.ok) throw new Error('Top-traders request returned ok:false');
  return body.topTraders;
}

export async function getLatestOpens(
  coin: string,
  limit = 10,
): Promise<TraderOpen[]> {
  const body = await apiGet<LatestOpensResponse>(
    `/api/assets/${encodeURIComponent(coin)}/latest-trades?limit=${limit}`,
  );
  if (!body.ok) throw new Error('Latest-trades request returned ok:false');
  return body.latestOpens;
}

interface ListAssetsResponse {
  ok: true;
  assets: Asset[];
}

export async function getAsset(coin: string): Promise<Asset | null> {
  const body = await apiGet<ListAssetsResponse>('/api/assets');
  if (!body.ok) throw new Error('Assets request returned ok:false');
  const wanted = coin.toLowerCase();
  return (
    body.assets.find(
      (a) => a.coin.toLowerCase() === wanted || a.symbol.toLowerCase() === wanted,
    ) ?? null
  );
}
