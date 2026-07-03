import { hl } from '../hl.js';
import { getEpRoster } from '../ep/roster.js';
import { getEpTradesForCoin } from '../ep/trades.js';
import { getEpOpenPositionsForCoin, type SmartPosition } from '../ep/positions.js';
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

/** One closed EP trade, shaped for the asset chart's smart-money markers. */
export interface SmartMarkTrade {
  address: string;
  displayName: string | null;
  direction: string;
  szBase: number;
  notionalUsd: number;
  entryPxUsd: number;
  exitPxUsd: number;
  netPnlUsd: number;
  openedAtMs: number | null;
  closedAtMs: number;
}

/** Aggregated EP open interest on one side of a coin. `avgPxUsd` is the
 *  notional-weighted average entry — the canonical definition lives HERE. */
export interface SmartEntryLevel {
  count: number;
  avgPxUsd: number;
  notionalUsd: number;
}

export interface SmartMarks {
  trades: SmartMarkTrade[];
  entryLevels: { long: SmartEntryLevel | null; short: SmartEntryLevel | null };
}

function toEntryLevel(positions: SmartPosition[], side: 'long' | 'short'): SmartEntryLevel | null {
  let count = 0;
  let notionalUsd = 0;
  let weightedPx = 0;
  for (const p of positions) {
    if (p.side !== side || p.entryPxUsd <= 0 || p.notionalUsd <= 0) continue;
    count += 1;
    notionalUsd += p.notionalUsd;
    weightedPx += p.entryPxUsd * p.notionalUsd;
  }
  if (count === 0 || notionalUsd <= 0) return null;
  return { count, avgPxUsd: weightedPx / notionalUsd, notionalUsd };
}

/**
 * Smart-money marks for the asset chart: the EP cohort's recent closed trades
 * on this coin (dot markers) plus per-side aggregate entry levels of its open
 * positions (dashed lines). Derives entirely from the EP trades/positions
 * caches — no extra Hyperdash fetches.
 */
export async function getAssetSmartMarks(coin: string): Promise<SmartMarks> {
  const [trades, positions] = await Promise.all([
    getEpTradesForCoin(coin, 80),
    getEpOpenPositionsForCoin(coin),
  ]);
  return {
    trades: trades.map<SmartMarkTrade>((t) => ({
      address: t.address,
      displayName: t.displayName,
      direction: t.direction,
      szBase: t.szBase,
      notionalUsd: t.notionalUsd,
      entryPxUsd: t.entryPxUsd,
      exitPxUsd: t.exitPxUsd,
      netPnlUsd: t.netPnlUsd,
      openedAtMs: t.openedAtMs,
      closedAtMs: t.closedAtMs,
    })),
    entryLevels: {
      long: toEntryLevel(positions, 'long'),
      short: toEntryLevel(positions, 'short'),
    },
  };
}
