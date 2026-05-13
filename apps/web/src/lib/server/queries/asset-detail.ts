import { and, desc, eq, sql } from 'drizzle-orm';
import { fills } from '@copytrade/db';
import { db } from '../db.js';
import { hl } from '../hl.js';
import { listAssets, type AssetRow } from './assets.js';
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
  { interval: '1m' | '5m' | '15m' | '1h' | '4h'; lookbackMs: number }
> = {
  '1h': { interval: '1m', lookbackMs: 60 * 60 * 1000 },
  '4h': { interval: '5m', lookbackMs: 4 * 60 * 60 * 1000 },
  '1d': { interval: '15m', lookbackMs: 24 * 60 * 60 * 1000 },
  '7d': { interval: '1h', lookbackMs: 7 * 24 * 60 * 60 * 1000 },
  '30d': { interval: '4h', lookbackMs: 30 * 24 * 60 * 60 * 1000 },
};

export interface AssetDetail {
  asset: AssetRow;
  range: RangeKey;
  candles: CandlePoint[];
  topTraders: TopTrader[];
  /** Recent position-open events from the top traders, ready to overlay on
   *  the chart as avatar markers. Limited per trader so a hyper-active
   *  scalper doesn't paint the whole canvas. */
  traderOpens: TraderOpen[];
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

/** All-time top traders on this coin by SUM(closed_pnl). Also returns an ROI
 *  estimate per trader (= PnL / closed-out notional). */
export async function getAssetTopTraders(coin: string, limit = 5): Promise<TopTrader[]> {
  const rows = await db()
    .select({
      address: fills.userAddress,
      totalPnl: sql<string>`sum(${fills.closedPnl})`.as('total_pnl'),
      grossNotional: sql<string>`sum(abs(${fills.sz} * ${fills.px}))`.as('gross_notional'),
      n: sql<string>`count(*)`.as('n'),
    })
    .from(fills)
    .where(and(eq(fills.coin, coin), sql`${fills.closedPnl} <> 0`))
    .groupBy(fills.userAddress)
    .orderBy(desc(sql`sum(${fills.closedPnl})`))
    .limit(limit);
  return rows.map((r) => {
    const totalPnl = Number.parseFloat(r.totalPnl);
    const notional = Number.parseFloat(r.grossNotional);
    return {
      address: r.address,
      totalPnlUsd: totalPnl,
      tradeCount: Number.parseInt(r.n, 10),
      roi: Number.isFinite(notional) && notional > 0 ? totalPnl / notional : null,
    };
  });
}

/** Most-recent N "fresh" position-open fills (start_position = 0) on this
 *  coin for each address, within `[startMs, endMs]`. Used to paint the
 *  chart with avatar markers at the moment each top trader entered. */
export async function getTraderOpensInRange(
  coin: string,
  addresses: string[],
  startMs: number,
  endMs: number,
  limitPerTrader = 3,
): Promise<TraderOpen[]> {
  if (addresses.length === 0) return [];
  const conn = db();
  const buckets = await Promise.all(
    addresses.map(async (addr) => {
      const rows = await conn
        .select({
          blockTimeMs: fills.blockTimeMs,
          side: fills.side,
          px: fills.px,
        })
        .from(fills)
        .where(
          and(
            eq(fills.coin, coin),
            eq(fills.userAddress, addr),
            sql`${fills.blockTimeMs} >= ${startMs}`,
            sql`${fills.blockTimeMs} <= ${endMs}`,
            sql`${fills.sz} > 0`,
            // "Position open" = either a clean entry from flat, OR a sign-flip
            // (long → short or vice versa in a single fill). Skip plain
            // scale-ins / scale-outs since they're not new exposure events.
            sql`(
              ${fills.startPosition} = 0
              OR (
                ${fills.startPosition} <> 0
                AND sign(
                  ${fills.startPosition}
                  + (case ${fills.side} when 'B' then ${fills.sz} else -${fills.sz} end)
                ) <> sign(${fills.startPosition})
                AND ${fills.startPosition}
                  + (case ${fills.side} when 'B' then ${fills.sz} else -${fills.sz} end)
                  <> 0
              )
            )`,
          ),
        )
        .orderBy(desc(fills.blockTimeMs))
        .limit(limitPerTrader);
      return rows.map<TraderOpen>((r) => ({
        address: addr,
        blockTimeMs: Number(r.blockTimeMs),
        side: r.side as 'B' | 'A',
        pxUsd: Number.parseFloat(r.px),
      }));
    }),
  );
  return buckets.flat();
}

/** Loader for `/assets/[coin]`. Returns null when the coin isn't in the universe.
 *  Validates the coin against the universe first — calling `candleSnapshot`
 *  for an unknown coin makes HL throw, which would surface as a 500. */
export async function getAssetDetail(coin: string, range: RangeKey): Promise<AssetDetail | null> {
  const assetList = await listAssets();
  const asset = assetList.find((a) => a.coin === coin);
  if (!asset) return null;
  const [candles, topTraders] = await Promise.all([
    getAssetCandles(coin, range),
    getAssetTopTraders(coin, 5),
  ]);
  // Use the candle window as the marker window so we don't paint avatars
  // that fall outside the visible chart.
  const startMs = candles.length > 0 ? candles[0]!.t : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const endMs = Date.now();
  const traderOpens = await getTraderOpensInRange(
    coin,
    topTraders.map((t) => t.address),
    startMs,
    endMs,
    3,
  );
  return { asset, range, candles, topTraders, traderOpens };
}
