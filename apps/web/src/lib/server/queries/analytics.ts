import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { fills, leaderCache, wallets } from '@copytrade/db';
import { coinCategory } from '$lib/utils/coin';
import { db } from '../db.js';
import { listAllAssetsRaw } from './assets.js';

/**
 * Server queries powering `/analytics` — four panels:
 *   1. `getCategoryPositionBreakdown` — long/short split by Stock & Commodity
 *                                        vs Crypto across every tracked trader.
 *   2. `getLatestFills`               — most-recent fills from the tracked set.
 *   3. `getPositionMatrix`            — top-25 wallets × top N coins; coloured cells.
 *   4. `getTopOpenPositions`          — currently-open positions ranked by PnL.
 *
 * Design: docs/plans/2026-05-13-analytics-page-idea.md.
 */

// ── Latest trades ──────────────────────────────────────────────────────

export interface LatestFill {
  /** HL's per-fill primary key. Unique even when two fills share `blockTimeMs`
   *  (one trader filling a multi-leg order in the same ms — common for bots);
   *  used as the `{#each}` key in the client so Svelte 5 hydration doesn't
   *  collide and tear the tree down. */
  tid: number;
  address: string;
  blockTimeMs: number;
  coin: string;
  side: 'B' | 'A';
  szBase: number;
  pxUsd: number;
  /** signed: positive on `B` (buy), negative on `A` (sell). Useful for the closing-trade colour. */
  closedPnlUsd: number;
}

/** Most-recent fills across tracked wallets (any wallet with a leader_cache row).
 *  Sorted by `block_time_ms desc`, limited so the panel stays scannable. */
export async function getLatestFills(limit = 10): Promise<LatestFill[]> {
  const rows = await db()
    .select({
      tid: fills.tid,
      address: fills.userAddress,
      blockTimeMs: fills.blockTimeMs,
      coin: fills.coin,
      side: fills.side,
      sz: fills.sz,
      px: fills.px,
      closedPnl: fills.closedPnl,
    })
    .from(fills)
    .where(
      // Only wallets we actually surface. `leader_cache` is the tracked set
      // (winners write via WS; the rest via on-demand REST snapshots).
      inArray(
        fills.userAddress,
        db().select({ address: leaderCache.address }).from(leaderCache),
      ),
    )
    .orderBy(desc(fills.blockTimeMs))
    .limit(limit);

  return rows.map((r) => ({
    tid: Number(r.tid),
    address: r.address,
    blockTimeMs: Number(r.blockTimeMs),
    coin: r.coin,
    side: r.side as 'B' | 'A',
    szBase: Number.parseFloat(r.sz),
    pxUsd: Number.parseFloat(r.px),
    closedPnlUsd: Number.parseFloat(r.closedPnl),
  }));
}

// ── Position matrix ────────────────────────────────────────────────────

export interface MatrixTrader {
  address: string;
  score: number | null;
  equityUsd: number | null;
}

export interface MatrixCoin {
  coin: string;
  /** how many of the matrix traders currently hold this coin */
  holders: number;
  /** signed net of long − short notional in USD across the matrix traders */
  netNotionalUsd: number;
  /** HL's 24h notional volume on the perp — drives column ordering. */
  volume24hUsd: number | null;
}

export interface MatrixCell {
  side: 'long' | 'short';
  szBase: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  /** `notional / equity` — how big this position is relative to the trader's book. */
  pctOfBook: number;
  leverage: number;
}

export interface PositionMatrix {
  traders: MatrixTrader[];
  coins: MatrixCoin[];
  /** key = `address|coin`; cells without a position aren't in the map. */
  cells: Record<string, MatrixCell>;
}

/**
 * Top `tradersLimit` wallets (by `score desc`) × the union of coins they're
 * currently positioned on (filtered to coins held by ≥ `coinMinHolders`,
 * capped at `coinsLimit`, sorted by holder count desc then net notional).
 *
 * One pass over `leader_cache` for the matrix traders, unpacking
 * `positions_json` via `jsonb_array_elements`. All maths in JS — keeps the
 * SQL readable.
 */
export async function getPositionMatrix(opts: {
  tradersLimit?: number;
  coinsLimit?: number;
  /** Minimum number of matrix traders that must hold a coin for it to make the
   *  cut. `1` (default) is the user-chosen "intersection" mode: rank coins by
   *  HL 24h volume, but drop coins nobody in the cohort actually holds. Set
   *  `>= 2` to require overlap, or pull volume-only by re-shaping the call. */
  coinMinHolders?: number;
} = {}): Promise<PositionMatrix> {
  const tradersLimit = opts.tradersLimit ?? 25;
  const coinsLimit = opts.coinsLimit ?? 18;
  const coinMinHolders = opts.coinMinHolders ?? 1;

  // 1. Pick the matrix's trader set — any tracked wallet that *currently*
  //    holds positions (`leader_cache.positions_json` non-empty), ordered
  //    by `score desc NULLS LAST`. Including un-scored wallets keeps the
  //    matrix from going blank on whole markets just because the score
  //    gate hasn't run on a freshly-discovered wallet trading HIP-3
  //    names. Score-ranked traders still come first; un-scored fill the
  //    bottom rows (ordered by equity desc).
  //
  //    Asset universe pulled in parallel — raw, un-deduped, since
  //    `leader_cache` positions are keyed by the fully-qualified coin
  //    name (`cash:TSLA`, not `TSLA`); the volume lookup must be 1:1.
  const [traderResp, assetList] = await Promise.all([
    db().execute<{ address: string; score: number | null; account_value: string | null }>(sql`
      SELECT w.address, w.score, w.account_value
      FROM wallets w
      JOIN leader_cache lc ON lc.address = w.address
      WHERE coalesce(w.is_agent, false) = false
        AND w.account_value IS NOT NULL
        AND lc.positions_json IS NOT NULL
        AND jsonb_array_length(lc.positions_json) > 0
      ORDER BY w.score DESC NULLS LAST, w.account_value::numeric DESC
      LIMIT ${tradersLimit}
    `),
    listAllAssetsRaw(),
  ]);
  const traderRows = traderResp.rows.map((r) => ({
    address: r.address,
    score: r.score,
    accountValue: r.account_value,
  }));
  const volumeByCoin = new Map<string, number>();
  for (const a of assetList) {
    if (a.volume24h !== null) volumeByCoin.set(a.coin, a.volume24h);
  }

  const traders: MatrixTrader[] = traderRows.map((r) => ({
    address: r.address,
    score: r.score,
    equityUsd: r.accountValue !== null ? Number.parseFloat(r.accountValue) : null,
  }));
  const traderAddresses = traders.map((t) => t.address);
  if (traderAddresses.length === 0) {
    return { traders: [], coins: [], cells: {} };
  }

  // 2. Pull every (trader, coin) position they currently hold. We pre-
  //    filter by `address IN (SELECT address FROM wallets WHERE score IS NOT NULL ...)`
  //    instead of binding the JS string-array via ANY() — node-postgres
  //    doesn't auto-cast `${jsArray}` to text[] inside a raw `sql\`` and
  //    Drizzle won't infer the cast either. The subquery does the same
  //    filtering work without that footgun.
  const traderSet = new Set(traderAddresses);
  const cellRows = await db().execute<{
    address: string;
    coin: string;
    szi: string;
    notional: string;
    unrealized_pnl: string;
    leverage: string | null;
  }>(sql`
    SELECT
      lc.address,
      (p.elem -> 'position' ->> 'coin')           AS coin,
      (p.elem -> 'position' ->> 'szi')            AS szi,
      (p.elem -> 'position' ->> 'positionValue')  AS notional,
      (p.elem -> 'position' ->> 'unrealizedPnl')  AS unrealized_pnl,
      (p.elem -> 'position' -> 'leverage' ->> 'value') AS leverage
    FROM leader_cache lc,
         LATERAL jsonb_array_elements(lc.positions_json) AS p(elem)
    WHERE lc.positions_json IS NOT NULL
  `);
  const filteredRows = cellRows.rows.filter((r) => traderSet.has(r.address));

  // 3. Aggregate per-coin stats + build the (address, coin) cell map.
  const equityByAddr = new Map<string, number | null>();
  for (const t of traders) equityByAddr.set(t.address, t.equityUsd);

  const coinAgg = new Map<
    string,
    { holders: Set<string>; netNotional: number }
  >();
  const cells: Record<string, MatrixCell> = {};
  for (const r of filteredRows) {
    const szi = Number.parseFloat(r.szi);
    if (!Number.isFinite(szi) || szi === 0) continue;
    const notional = Math.abs(Number.parseFloat(r.notional));
    const pnl = Number.parseFloat(r.unrealized_pnl);
    const lev = r.leverage !== null ? Number.parseFloat(r.leverage) : NaN;
    const side: 'long' | 'short' = szi > 0 ? 'long' : 'short';
    const equity = equityByAddr.get(r.address) ?? null;
    const pctOfBook = equity !== null && equity > 0 ? notional / equity : 0;

    cells[`${r.address}|${r.coin}`] = {
      side,
      szBase: Math.abs(szi),
      notionalUsd: notional,
      unrealizedPnlUsd: Number.isFinite(pnl) ? pnl : 0,
      pctOfBook,
      leverage: Number.isFinite(lev) ? lev : 0,
    };

    const agg = coinAgg.get(r.coin) ?? { holders: new Set<string>(), netNotional: 0 };
    agg.holders.add(r.address);
    agg.netNotional += side === 'long' ? notional : -notional;
    coinAgg.set(r.coin, agg);
  }

  // 4. Pick the coin universe — "intersection mode" per the user's call:
  //    rank by HL 24h notional volume desc, but filter to coins at least
  //    `coinMinHolders` matrix traders actually hold (default 1, i.e. any
  //    coin held by anyone). Result: the volume-headline names (BTC / ETH
  //    / SOL …) are at the left of the matrix, but no fully-empty columns.
  const coins: MatrixCoin[] = [...coinAgg.entries()]
    .filter(([, v]) => v.holders.size >= coinMinHolders)
    .map(([coin, v]) => ({
      coin,
      holders: v.holders.size,
      netNotionalUsd: v.netNotional,
      volume24hUsd: volumeByCoin.get(coin) ?? null,
    }))
    .sort((a, b) => {
      // Volume desc — coins with no volume data fall to the back.
      const av = a.volume24hUsd ?? -1;
      const bv = b.volume24hUsd ?? -1;
      if (av !== bv) return bv - av;
      // Tie-break: more holders, then bigger absolute net notional.
      const dh = b.holders - a.holders;
      if (dh !== 0) return dh;
      return Math.abs(b.netNotionalUsd) - Math.abs(a.netNotionalUsd);
    })
    .slice(0, coinsLimit);

  return { traders, coins, cells };
}

// ── Top open positions ─────────────────────────────────────────────────

export interface TopOpenPosition {
  address: string;
  coin: string;
  side: 'long' | 'short';
  szBase: number;
  entryPxUsd: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  returnOnEquity: number;
  leverage: number;
  lastRefreshedAtMs: number | null;
}

/** Top `limit` currently-open positions globally, sorted by `unrealized_pnl desc`.
 *  Same JSONB unpack as `getOpenPositionsOnAsset` but un-filtered by coin. */
export async function getTopOpenPositions(limit = 25): Promise<TopOpenPosition[]> {
  const rows = await db().execute<{
    address: string;
    last_refreshed_at: string | Date | null;
    coin: string;
    szi: string;
    entry_px: string;
    notional: string;
    unrealized_pnl: string;
    return_on_equity: string;
    leverage: string | null;
  }>(sql`
    SELECT
      lc.address,
      lc.last_refreshed_at,
      (p.elem -> 'position' ->> 'coin')            AS coin,
      (p.elem -> 'position' ->> 'szi')             AS szi,
      (p.elem -> 'position' ->> 'entryPx')         AS entry_px,
      (p.elem -> 'position' ->> 'positionValue')   AS notional,
      (p.elem -> 'position' ->> 'unrealizedPnl')   AS unrealized_pnl,
      (p.elem -> 'position' ->> 'returnOnEquity')  AS return_on_equity,
      (p.elem -> 'position' -> 'leverage' ->> 'value') AS leverage
    FROM leader_cache lc,
         LATERAL jsonb_array_elements(lc.positions_json) AS p(elem)
    WHERE lc.positions_json IS NOT NULL
    ORDER BY (p.elem -> 'position' ->> 'unrealizedPnl')::numeric DESC
    LIMIT ${limit}
  `);

  const out: TopOpenPosition[] = [];
  for (const r of rows.rows) {
    const szi = Number.parseFloat(r.szi);
    if (!Number.isFinite(szi) || szi === 0) continue;
    out.push({
      address: r.address,
      coin: r.coin,
      side: szi > 0 ? 'long' : 'short',
      szBase: Math.abs(szi),
      entryPxUsd: Number.parseFloat(r.entry_px),
      notionalUsd: Math.abs(Number.parseFloat(r.notional)),
      unrealizedPnlUsd: Number.parseFloat(r.unrealized_pnl),
      returnOnEquity: Number.parseFloat(r.return_on_equity),
      leverage: r.leverage !== null ? Number.parseFloat(r.leverage) : 0,
      lastRefreshedAtMs: r.last_refreshed_at
        ? r.last_refreshed_at instanceof Date
          ? r.last_refreshed_at.getTime()
          : Date.parse(r.last_refreshed_at)
        : null,
    });
  }
  return out;
}

// ── Category position breakdown (Stock & Commodity vs Crypto) ──────────

export interface CategoryPositionBreakdown {
  /** Folded categories per user direction: index assets fold into 'stocks'. */
  category: 'stocks' | 'crypto';
  long: {
    /** Sum of long-side notional across every tracked trader, USD. */
    notionalUsd: number;
    /** Distinct tracked traders holding any long position in this category. */
    traders: number;
  };
  short: {
    notionalUsd: number;
    traders: number;
  };
}

/**
 * Long/short sentiment split across every tracked wallet's currently-open
 * positions, bucketed by asset category. The category-3 (`'index'`) bucket
 * is folded into `'stocks'` so the analytics header surfaces a clean
 * two-bar Stock-vs-Crypto view; if we ever want a separate Index bar, drop
 * the fold here.
 *
 * Same JSONB-unpack pattern as `getTopOpenPositions`, just unsorted and
 * un-limited — we want every position.
 */
export async function getCategoryPositionBreakdown(): Promise<
  CategoryPositionBreakdown[]
> {
  const rows = await db().execute<{
    address: string;
    coin: string;
    szi: string;
    notional: string;
  }>(sql`
    SELECT
      lc.address,
      (p.elem -> 'position' ->> 'coin')          AS coin,
      (p.elem -> 'position' ->> 'szi')           AS szi,
      (p.elem -> 'position' ->> 'positionValue') AS notional
    FROM leader_cache lc,
         LATERAL jsonb_array_elements(lc.positions_json) AS p(elem)
    WHERE lc.positions_json IS NOT NULL
  `);

  type Cat = 'stocks' | 'crypto';
  type Side = 'long' | 'short';
  const notional: Record<Cat, Record<Side, number>> = {
    stocks: { long: 0, short: 0 },
    crypto: { long: 0, short: 0 },
  };
  const traders: Record<Cat, Record<Side, Set<string>>> = {
    stocks: { long: new Set(), short: new Set() },
    crypto: { long: new Set(), short: new Set() },
  };

  for (const r of rows.rows) {
    const szi = Number.parseFloat(r.szi);
    if (!Number.isFinite(szi) || szi === 0) continue;
    const n = Math.abs(Number.parseFloat(r.notional));
    if (!Number.isFinite(n) || n === 0) continue;

    // Coin name is either bare (`BTC`) or qualified (`xyz:TSLA`). The same
    // string format `coinCategory` expects everywhere else.
    const colonIdx = r.coin.indexOf(':');
    const dex = colonIdx === -1 ? null : r.coin.slice(0, colonIdx);
    const cat3 = coinCategory(r.coin, dex);
    const cat: Cat = cat3 === 'crypto' ? 'crypto' : 'stocks';
    const side: Side = szi > 0 ? 'long' : 'short';

    notional[cat][side] += n;
    traders[cat][side].add(r.address);
  }

  return (['stocks', 'crypto'] as const).map((cat) => ({
    category: cat,
    long: { notionalUsd: notional[cat].long, traders: traders[cat].long.size },
    short: { notionalUsd: notional[cat].short, traders: traders[cat].short.size },
  }));
}
