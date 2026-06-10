import { and, desc, eq, sql } from 'drizzle-orm';
import { fills } from '@copytrade/db';
import { db } from '../db.js';
import { hl } from '../hl.js';
import { listAssets, type AssetRow } from './assets.js';
import {
  RANGE_KEYS,
  parseRange,
  type CandlePoint,
  type OpenPosition,
  type RangeKey,
  type TopTrader,
  type TraderOpen,
} from '$lib/utils/asset-ranges';

// Re-export so server-side callers (loaders, API routes) have one import.
export { RANGE_KEYS, parseRange };
export type { CandlePoint, OpenPosition, RangeKey, TopTrader, TraderOpen };

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
  /** Currently-open positions on this asset held by tracked wallets, sorted
   *  by unrealized PnL desc. Source: `leader_cache.positions_json`. */
  openPositions: OpenPosition[];
  /** N most-recent position-opens on this asset across all tracked wallets,
   *  sorted by block_time_ms desc. The chart-marker `traderOpens` list is
   *  per-trader (top 3 each); this is global. */
  latestOpens: TraderOpen[];
}

function num(s: string | null | undefined): number {
  if (s === null || s === undefined) return NaN;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** `db.execute()` doesn't run the ORM's column casters, so a `timestamptz`
 *  comes back as an ISO string. Some pg drivers occasionally hand us a Date
 *  anyway — accept both. */
function parseTimestampMs(input: string | Date | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) return input.getTime();
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
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

/** All currently-open positions on `coin` held by wallets in our
 *  `leader_cache` (= tracked wallets — winners get live WS pushes, the rest
 *  are REST snapshots, possibly stale; the UI shows a freshness badge per
 *  row). Sorted by unrealized PnL desc, so the wallet most in-profit on
 *  this coin right now leads. */
export async function getOpenPositionsOnAsset(
  coin: string,
  limit = 25,
): Promise<OpenPosition[]> {
  const rows = await db().execute<{
    address: string;
    /** pg returns `timestamptz` as an ISO string here, not a Date (no ORM cast
     *  on `db.execute`). */
    last_refreshed_at: string | null;
    source: string | null;
    szi: string;
    entry_px: string;
    notional: string;
    unrealized_pnl: string;
    return_on_equity: string;
    leverage: string;
  }>(sql`
    SELECT
      lc.address,
      lc.last_refreshed_at,
      lc.source,
      (p.elem -> 'position' ->> 'szi')             AS szi,
      (p.elem -> 'position' ->> 'entryPx')         AS entry_px,
      (p.elem -> 'position' ->> 'positionValue')   AS notional,
      (p.elem -> 'position' ->> 'unrealizedPnl')   AS unrealized_pnl,
      (p.elem -> 'position' ->> 'returnOnEquity')  AS return_on_equity,
      (p.elem -> 'position' -> 'leverage' ->> 'value') AS leverage
    FROM leader_cache lc,
         LATERAL jsonb_array_elements(lc.positions_json) AS p(elem)
    WHERE lc.positions_json IS NOT NULL
      AND (p.elem -> 'position' ->> 'coin') = ${coin}
    ORDER BY (p.elem -> 'position' ->> 'unrealizedPnl')::numeric DESC
    LIMIT ${limit}
  `);

  const out: OpenPosition[] = [];
  for (const r of rows.rows) {
    const szi = Number.parseFloat(r.szi);
    if (!Number.isFinite(szi) || szi === 0) continue;
    const unrealizedPnlUsd = Number.parseFloat(r.unrealized_pnl);
    const notionalUsd = Number.parseFloat(r.notional);
    const entryPx = Number.parseFloat(r.entry_px);
    const roe = Number.parseFloat(r.return_on_equity);
    const lev = Number.parseFloat(r.leverage);
    out.push({
      address: r.address,
      side: szi > 0 ? 'long' : 'short',
      szBase: Math.abs(szi),
      entryPxUsd: Number.isFinite(entryPx) ? entryPx : 0,
      notionalUsd: Number.isFinite(notionalUsd) ? notionalUsd : 0,
      unrealizedPnlUsd: Number.isFinite(unrealizedPnlUsd) ? unrealizedPnlUsd : 0,
      returnOnEquity: Number.isFinite(roe) ? roe : 0,
      leverage: Number.isFinite(lev) ? lev : 0,
      lastRefreshedAtMs: parseTimestampMs(r.last_refreshed_at),
      source:
        r.source === 'ws'
          ? 'ws'
          : r.source === 'rest_poll' || r.source === 'rest_ondemand'
            ? 'rest'
            : null,
    });
  }
  return out;
}

/** The N most-recent position-opens on `coin` across *all* tracked wallets
 *  (no per-trader cap). Same "fresh open or sign-flip" detection as
 *  `getTraderOpensInRange`. Used for the "Latest opens" side-table on the
 *  asset detail page — answers "who just took a position on this coin?". */
export async function getLatestOpensOnAsset(coin: string, limit = 10): Promise<TraderOpen[]> {
  const rows = await db()
    .select({
      address: fills.userAddress,
      blockTimeMs: fills.blockTimeMs,
      side: fills.side,
      px: fills.px,
    })
    .from(fills)
    .where(
      and(
        eq(fills.coin, coin),
        sql`${fills.sz} > 0`,
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
    .limit(limit);
  return rows.map<TraderOpen>((r) => ({
    address: r.address,
    blockTimeMs: Number(r.blockTimeMs),
    side: r.side as 'B' | 'A',
    pxUsd: Number.parseFloat(r.px),
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
    getOpenPositionsOnAsset(coin, 25),
    getLatestOpensOnAsset(coin, 10),
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
  return { asset, range, candles, topTraders, traderOpens, openPositions, latestOpens };
}
