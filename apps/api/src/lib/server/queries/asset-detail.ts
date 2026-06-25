import { hl } from '../hl.js';
import { listAssets, type AssetRow } from './assets.js';
import { getEpRoster } from '../ep/roster.js';
import { getEpTradesForCoin } from '../ep/trades.js';
import { getEpPositionsForCoin } from '../ep/positions.js';
import type { MarketPositions } from '../ep/positions.js';
import {
  RANGE_KEYS,
  parseRange,
  type CandlePoint,
  type RangeKey,
  type TopTrader,
  type TraderOpen,
} from '$lib/utils/asset-ranges';

// Re-export so server-side callers (loaders, API routes) have one import.
export { RANGE_KEYS, parseRange };
export type { CandlePoint, RangeKey, TopTrader, TraderOpen };

/** Each range maps to a HL candle interval + a lookback window. */
const RANGE: Record<
  RangeKey,
  { interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d'; lookbackMs: number }
> = {
  '1h': { interval: '1m', lookbackMs: 60 * 60 * 1000 },
  '4h': { interval: '5m', lookbackMs: 4 * 60 * 60 * 1000 },
  '1d': { interval: '15m', lookbackMs: 24 * 60 * 60 * 1000 },
  '7d': { interval: '1h', lookbackMs: 7 * 24 * 60 * 60 * 1000 },
  '30d': { interval: '4h', lookbackMs: 30 * 24 * 60 * 60 * 1000 },
  // Full history: daily candles over a multi-year window. HL caps the
  // response (~5000 candles), which comfortably covers any coin's lifetime
  // at this interval, so the array naturally starts at the coin's first day.
  'all': { interval: '1d', lookbackMs: 5 * 365 * 24 * 60 * 60 * 1000 },
};

export interface AssetDetail {
  asset: AssetRow;
  range: RangeKey;
  candles: CandlePoint[];
  topTraders: TopTrader[];
  /** Recent closed trades by the EP cohort on this coin, surfaced as the
   *  "Latest trades" list. (Was per-trader chart-marker opens; the EP module
   *  exposes completed round-trips, mapped into the same `TraderOpen` shape.) */
  latestOpens: TraderOpen[];
  /** EP-cohort open positions on this coin (long/short split + rows), or null
   *  when the cohort holds nothing here. Source: `getEpPositionsForCoin`. */
  openPositions: MarketPositions | null;
}

function num(s: string | null | undefined): number {
  if (s === null || s === undefined) return NaN;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** OHLCV from HL `candleSnapshot`, mapped to numbers. */
export async function getAssetCandles(coin: string, range: RangeKey): Promise<CandlePoint[]> {
  const spec = RANGE[range];
  const endTime = Date.now();
  const startTime = endTime - spec.lookbackMs;
  const res = await hl().candleSnapshot({ coin, interval: spec.interval, startTime, endTime });
  return res.data.map((k) => ({
    t: k.t,
    o: num(k.o),
    c: num(k.c),
    h: num(k.h),
    l: num(k.l),
    v: num(k.v),
  }));
}

/**
 * Top EP-cohort traders on this coin, ranked by their all-time realized PnL on
 * the coin. Derived from `getEpRoster()`: each roster trader carries a
 * `topAssets` list (their ~5 biggest coins by volume, with per-coin PnL); we
 * keep the ones that include `coin` and sort by that coin's PnL desc.
 *
 * Hyperdash has no per-coin trade count or per-coin closed notional, so the
 * `tradeCount` and `roi` fields of the `TopTrader` shape have no source here:
 * `tradeCount` defaults to 0 and `roi` to null (the mobile asset page already
 * renders `roi === null` as `—`). The shape is preserved for the client.
 */
export async function getAssetTopTraders(coin: string, limit = 5): Promise<TopTrader[]> {
  const roster = await getEpRoster();
  return roster
    .map((t) => {
      const onCoin = t.topAssets.find((a) => a.coin === coin);
      return onCoin ? { address: t.address, totalPnlUsd: onCoin.pnlUsd } : null;
    })
    .filter((r): r is { address: string; totalPnlUsd: number } => r !== null)
    .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd)
    .slice(0, limit)
    .map((r) => ({
      address: r.address,
      totalPnlUsd: r.totalPnlUsd,
      tradeCount: 0,
      roi: null,
    }));
}

/**
 * Most-recent closed trades by the EP cohort on this coin, mapped into the
 * `TraderOpen` shape the asset page's "Latest trades" tab expects.
 *
 * `side` follows the trade's direction ('Long' → 'B', 'Short' → 'A'),
 * `blockTimeMs` is the trade's close time, and `pxUsd` is the entry price.
 * Source: `getEpTradesForCoin` (the shallow recent-trades cache — good for
 * "latest", not deep history).
 */
export async function getLatestOpensOnAsset(coin: string, limit = 10): Promise<TraderOpen[]> {
  const trades = await getEpTradesForCoin(coin, limit);
  return trades.map<TraderOpen>((t) => ({
    address: t.address,
    blockTimeMs: t.closedAtMs,
    side: t.direction.toLowerCase() === 'short' ? 'A' : 'B',
    pxUsd: t.entryPxUsd,
  }));
}

/** Loader for `/assets/[coin]`. Returns null when the coin isn't in the universe.
 *  Validates the coin against the universe first — calling `candleSnapshot`
 *  for an unknown coin makes HL throw, which would surface as a 500. */
export async function getAssetDetail(coin: string, range: RangeKey): Promise<AssetDetail | null> {
  const assetList = await listAssets();
  const asset = assetList.find((a) => a.coin === coin);
  if (!asset) return null;
  const [candles, topTraders, openPositions, latestOpens] = await Promise.all([
    getAssetCandles(coin, range),
    getAssetTopTraders(coin, 5),
    getEpPositionsForCoin(coin),
    getLatestOpensOnAsset(coin, 10),
  ]);
  return { asset, range, candles, topTraders, openPositions, latestOpens };
}
