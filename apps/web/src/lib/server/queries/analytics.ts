import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { fills, leaderCache, wallets } from '@copytrade/db';
import { db } from '../db.js';
import { listAssets } from './assets.js';

/**
 * Server queries powering `/analytics` — three panels:
 *   1. `getLatestFills`         — most-recent fills from the tracked set.
 *   2. `getPositionMatrix`      — top-25 wallets × top N coins; coloured cells.
 *   3. `getTopOpenPositions`    — currently-open positions ranked by PnL.
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

  // 1. Pick the matrix's trader set (score-ranked, gate-passers) + the live
  //    HL asset universe (for the volume-based column ranking). Fetched in
  //    parallel — the asset list isn't cheap (one `metaAndAssetCtxs` call).
  const [traderRows, assetList] = await Promise.all([
    db()
      .select({
        address: wallets.address,
        score: wallets.score,
        accountValue: wallets.accountValue,
      })
      .from(wallets)
      .where(
        and(
          isNotNull(wallets.score),
          eq(wallets.isAgent, false),
          sql`${wallets.accountValue} is not null`,
        ),
      )
      .orderBy(desc(wallets.score))
      .limit(tradersLimit),
    listAssets(),
  ]);
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
