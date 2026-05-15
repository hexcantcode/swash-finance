import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { fills, leaderCache, wallets } from '@copytrade/db';
import { coinCategory } from '$lib/utils/coin';
import { db } from '../db.js';
import { resolveCoins } from '../spot-aliases';
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

/**
 * One *trade* — a single user order, even when HL split it into many fills
 * because it matched multiple counterparties. We group by `(master_address,
 * coin, side, oid)` so the panel shows one row per intent, not per market
 * impact, and so an agent + its master attribute to one row (the master).
 * When `oid` is null (rare — pre-HL-v2 ingest), each fill becomes its own
 * singleton group keyed by `tid` to avoid all-null-oid fills collapsing
 * into a single nonsense row.
 *
 * This is the shared shape behind both the `/analytics` Latest-trades panel
 * (`scope: 'tracked'`) and the global `TradeTicker` (`scope: 'all'`).
 */
export interface LatestTrade {
  /** Stable `{#each}` key. `oid` when set, else `tid:NNN` for null-oid fills. */
  key: string;
  /** Master wallet address — agent fills are rolled up to their master via
   *  `wallets.master_address`. Falls back to the fill's own `user_address`
   *  when no master is recorded (i.e. the wallet is itself a master). */
  address: string;
  coin: string;
  side: 'B' | 'A';
  /** How many fills made up this trade. 1 for true singletons. */
  fillCount: number;
  /** Total base size summed across the fills. */
  szBase: number;
  /** VWAP across the fills (`Σ(sz·px) / Σ(sz)`). */
  vwapUsd: number;
  /** Total USD notional (`Σ sz·px`). */
  notionalUsd: number;
  /** ms timestamp of the *latest* fill in the group — drives recency sort. */
  blockTimeMs: number;
  /** Trader's CURRENT per-coin leverage from `leader_cache.positions_json`
   *  — the same value `getTopOpenPositions` returns. Null when the trader
   *  has no open position on this coin right now (closed after the fill,
   *  or wallet not in leader_cache). Approximate for historical fills but
   *  accurate for recent ones, which is the panel's use case. */
  leverage: number | null;
}

/**
 * Most-recent *trades* across HL fills, with the order-aggregation rollup.
 *
 * - `scope: 'tracked'` (default) — restricts to wallets in `leader_cache`
 *   (the curated ~250 set). Powers the `/analytics` Latest-trades panel.
 * - `scope: 'all'` — no `leader_cache` filter; covers every ingested wallet,
 *   rolled to the master via `wallets.master_address`. Powers the global
 *   `TradeTicker` (used on `/traders` and `/assets`).
 *
 * - `aggregation: 'order'` (default) — groups fills by `(master_address,
 *   coin, side, oid)` so a market order that hit 10 counterparties — and
 *   any sub-fills under an agent that belongs to the master — shows as one
 *   row, not many. Right shape for the Latest-trades panel where every HL
 *   order is a distinct event the user wants to see.
 * - `aggregation: 'session'` — groups by `(master_address, coin, side,
 *   5-minute window)`. One row per trader-coin-side burst, so a scalper
 *   firing 26 single-fill orders on ZEC in two minutes collapses to a
 *   single ticker row rather than dominating the strip. Right shape for
 *   the ticker where the user wants signal density, not every order.
 */
export async function getLatestTrades(
  opts: {
    limit?: number;
    scope?: 'tracked' | 'all';
    aggregation?: 'order' | 'session';
  } = {},
): Promise<LatestTrade[]> {
  const limit = opts.limit ?? 10;
  const scope = opts.scope ?? 'tracked';
  const aggregation = opts.aggregation ?? 'order';
  // `WHERE` is an expression we inline conditionally — `sql` empty fragment
  // when scope = 'all' so the SQL stays grammatically valid either way.
  const scopeFilter =
    scope === 'tracked'
      ? sql`WHERE COALESCE(w.master_address, f.user_address) IN (SELECT address FROM leader_cache)`
      : sql``;

  // Aggregation key:
  //   - 'order'   → COALESCE(f.oid::text, 'tid:' || f.tid::text). Distinct
  //                 HL order or per-fill singleton when oid is null.
  //   - 'session' → integer-divide block_time_ms by 5 min (300_000 ms). Same
  //                 (trader, coin, side) within a 5-min bucket collapses;
  //                 makes the ticker resistant to one scalper flooding it.
  // The literal `300000` is inlined (not bound as a parameter) so both the
  // SELECT and GROUP BY references render to byte-identical SQL — Postgres
  // doesn't recognize `(c / $1)` and `(c / $2)` as the same expression
  // even when both parameters hold the same value.
  const groupKeyExpr =
    aggregation === 'session'
      ? sql.raw(`(f.block_time_ms / 300000)::text`)
      : sql`COALESCE(f.oid::text, 'tid:' || f.tid::text)`;

  const rows = await db().execute<{
    address: string;
    coin: string;
    side: 'B' | 'A';
    group_key: string;
    total_sz: string;
    total_notional: string;
    latest_ms: string | number;
    fill_count: string | number;
  }>(sql`
    SELECT
      COALESCE(w.master_address, f.user_address)  AS address,
      f.coin,
      f.side,
      ${groupKeyExpr}                              AS group_key,
      SUM(f.sz::numeric)                          AS total_sz,
      SUM(f.sz::numeric * f.px::numeric)          AS total_notional,
      MAX(f.block_time_ms)                        AS latest_ms,
      COUNT(*)                                    AS fill_count
    FROM fills f
    LEFT JOIN wallets w ON w.address = f.user_address
    ${scopeFilter}
    GROUP BY COALESCE(w.master_address, f.user_address), f.coin, f.side, ${groupKeyExpr}
    ORDER BY MAX(f.block_time_ms) DESC
    LIMIT ${limit}
  `);

  const trades = rows.rows.map((r) => {
    const szBase = Number.parseFloat(r.total_sz);
    const notionalUsd = Number.parseFloat(r.total_notional);
    return {
      key: `${r.address}|${r.group_key}`,
      address: r.address,
      coin: r.coin,
      side: r.side as 'B' | 'A',
      fillCount: Number(r.fill_count),
      szBase,
      notionalUsd,
      vwapUsd: szBase > 0 ? notionalUsd / szBase : 0,
      blockTimeMs: Number(r.latest_ms),
      leverage: null as number | null,
    };
  });

  // Enrich with per-coin leverage from `leader_cache.positions_json`. Same
  // JSONB shape `getTopOpenPositions` consumes, so the Latest trades and
  // Winning Trades panels read leverage from one source. Single round-trip
  // covers every (address, coin) pair in the visible trade list.
  if (trades.length > 0) {
    const addresses = Array.from(new Set(trades.map((t) => t.address)));
    // `node-postgres` won't auto-cast a JS array for `= ANY($n)` here, so
    // build an `IN (...)` list of individual parameters via `sql.join`.
    // (drizzle's `inArray` helper would also work but doesn't compose
    // cleanly inside this raw `sql` template that we already need for the
    // LATERAL unpack.)
    const addrList = sql.join(
      addresses.map((a) => sql`${a}`),
      sql`, `,
    );
    const levRows = await db().execute<{ address: string; coin: string; leverage: string | null }>(sql`
      SELECT
        lc.address,
        (p.elem -> 'position' ->> 'coin')              AS coin,
        (p.elem -> 'position' -> 'leverage' ->> 'value') AS leverage
      FROM leader_cache lc,
           LATERAL jsonb_array_elements(lc.positions_json) AS p(elem)
      WHERE lc.positions_json IS NOT NULL
        AND lc.address IN (${addrList})
    `);
    const levByKey = new Map<string, number>();
    for (const r of levRows.rows) {
      if (r.leverage === null) continue;
      const v = Number.parseFloat(r.leverage);
      if (Number.isFinite(v) && v > 0) levByKey.set(`${r.address}|${r.coin}`, v);
    }
    for (const t of trades) {
      t.leverage = levByKey.get(`${t.address}|${t.coin}`) ?? null;
    }
  }

  // Resolve HL spot `@N` pair IDs to friendly base-token names (`@107` →
  // `HYPE`, `@234` → `UBTC`, …) before returning. Done LAST so the leverage
  // enrichment above keys correctly against `leader_cache.positions_json`,
  // which stores the raw `@N` from HL. resolveCoins is a no-op (and skips
  // the spotMeta fetch) when the batch has no `@`-prefixed coins.
  const resolved = await resolveCoins(trades.map((t) => t.coin));
  for (let i = 0; i < trades.length; i++) trades[i]!.coin = resolved[i]!;

  return trades;
}

/**
 * Variant of `getLatestTrades` that returns trades pre-split by category —
 * `stocks` (HIP-3 builder dexes that aren't on the crypto whitelist, plus
 * the index symbols) on the left, `crypto` on the right. Same shape as
 * `getCategoryPositionBreakdown`'s buckets so the two panels classify
 * consistently. Over-fetches so we can deliver `perCategory` rows in each
 * bucket even when the data is heavily skewed toward one side.
 */
export interface CategorizedLatestTrades {
  stocks: LatestTrade[];
  crypto: LatestTrade[];
}
export async function getLatestTradesByCategory(
  opts: { perCategory?: number; scope?: 'tracked' | 'all' } = {},
): Promise<CategorizedLatestTrades> {
  const perCategory = opts.perCategory ?? 10;
  // Over-fetch — fills are heavily crypto-skewed, so we need a wide enough
  // window to reliably surface `perCategory` stocks rows. 200 is generous
  // and the query cost is dominated by the GROUP BY, not by the row count.
  const trades = await getLatestTrades(
    opts.scope !== undefined
      ? { limit: perCategory * 20, scope: opts.scope }
      : { limit: perCategory * 20 },
  );
  return splitTradesByCategory(trades, perCategory);
}

function splitTradesByCategory<T extends { coin: string }>(
  items: T[],
  perCategory: number,
): { stocks: T[]; crypto: T[] } {
  const stocks: T[] = [];
  const crypto: T[] = [];
  for (const it of items) {
    const cat = panelCategory(it.coin);
    if (cat === 'stocks' && stocks.length < perCategory) stocks.push(it);
    else if (cat === 'crypto' && crypto.length < perCategory) crypto.push(it);
    if (stocks.length >= perCategory && crypto.length >= perCategory) break;
  }
  return { stocks, crypto };
}

/** Two-bucket coin classifier shared by the /analytics panel-split helpers.
 *  `coinCategory` returns three values (`stocks` | `crypto` | `index`); we
 *  fold `index` into `stocks` so the panel grid stays a clean stocks-vs-crypto
 *  split (matches what the sentiment cards already do). */
function panelCategory(coin: string): 'stocks' | 'crypto' {
  const colonIdx = coin.indexOf(':');
  const dex = colonIdx === -1 ? null : coin.slice(0, colonIdx);
  const cat3 = coinCategory(coin, dex);
  return cat3 === 'crypto' ? 'crypto' : 'stocks';
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

  // 4. Pick the coin universe — pure HL 24h-volume rank from the *full*
  //    universe (main dex + every HIP-3 builder dex). HIP-3 markets
  //    (`cash:TSLA`, `xyz:MSTR`, …) show up at their natural volume rank
  //    even when no tracked trader currently holds them — empty cells
  //    that fill in the moment someone takes a position. The
  //    `coinMinHolders` knob is retained but ignored in this default
  //    path; callers wanting "intersection mode" can pass a custom
  //    sort post-hoc.
  void coinMinHolders;
  const coins: MatrixCoin[] = assetList
    .filter((a) => a.volume24h !== null && a.volume24h > 0)
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
    .slice(0, coinsLimit)
    .map((a) => {
      const agg = coinAgg.get(a.coin);
      return {
        coin: a.coin,
        holders: agg?.holders.size ?? 0,
        netNotionalUsd: agg?.netNotional ?? 0,
        volume24hUsd: a.volume24h,
      };
    });

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
  /** Cumulative realized PnL on this (address, coin) — `Σ (closedPnl − fee)`
   *  across every fill in the history. Zero when the trader has no closed
   *  fills on this coin yet (purely-open position). Ranking still uses
   *  `unrealizedPnlUsd`; this is the "what they've actually booked"
   *  display value in the Profit column. */
  realizedPnlUsd: number;
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
      realizedPnlUsd: 0,
    });
  }

  // Enrich with cumulative realized PnL per (address, coin) — `Σ (closedPnl
  // − fee)` from `fills`. Same semantic as `scores.winRate` / score path
  // (closedPnl net of fee = booked PnL on the closing leg). Single query
  // bounded by the panel's address+coin set so it's cheap regardless of
  // total fill volume.
  if (out.length > 0) {
    const addresses = Array.from(new Set(out.map((p) => p.address)));
    const coins = Array.from(new Set(out.map((p) => p.coin)));
    const addrList = sql.join(
      addresses.map((a) => sql`${a}`),
      sql`, `,
    );
    const coinList = sql.join(
      coins.map((c) => sql`${c}`),
      sql`, `,
    );
    const realRows = await db().execute<{ address: string; coin: string; realized: string }>(sql`
      SELECT
        f.user_address                                   AS address,
        f.coin,
        SUM(f.closed_pnl::numeric - f.fee::numeric)      AS realized
      FROM fills f
      WHERE f.user_address IN (${addrList})
        AND f.coin IN (${coinList})
      GROUP BY f.user_address, f.coin
    `);
    const realByKey = new Map<string, number>();
    for (const r of realRows.rows) {
      const v = Number.parseFloat(r.realized);
      if (Number.isFinite(v)) realByKey.set(`${r.address}|${r.coin}`, v);
    }
    for (const p of out) {
      p.realizedPnlUsd = realByKey.get(`${p.address}|${p.coin}`) ?? 0;
    }
  }

  // Resolve HL spot `@N` pair IDs to friendly base-token names before
  // returning (same step `getLatestTrades` runs at its tail). Done LAST so
  // the realized-PnL join above keys correctly against `fills.coin`, which
  // stores the raw `@N`.
  const resolved = await resolveCoins(out.map((p) => p.coin));
  for (let i = 0; i < out.length; i++) out[i]!.coin = resolved[i]!;

  return out;
}

/**
 * Variant of `getTopOpenPositions` that returns positions pre-split by
 * panel category. Same fold rules as `getLatestTradesByCategory` so the
 * two paired panels classify consistently. Ranking still descends by
 * unrealized PnL within each bucket.
 */
export interface CategorizedTopOpenPositions {
  stocks: TopOpenPosition[];
  crypto: TopOpenPosition[];
}
export async function getTopOpenPositionsByCategory(
  opts: { perCategory?: number } = {},
): Promise<CategorizedTopOpenPositions> {
  const perCategory = opts.perCategory ?? 10;
  // Over-fetch a broad pool of top open positions (ranked by unrealized
  // PnL in SQL — proxy for "active winners worth checking"), then in JS
  // narrow to those that have also booked realized profit on this coin
  // and re-rank by realized desc. The "Winning Trades" panel should only
  // contain wallets who've actually made money — a trader with $5M of
  // unrealized PnL but a $1M of realized losses on past closes is not a
  // "winner" worth surfacing here.
  //
  // Pool size: 50× perCategory keeps the SQL fast (leader_cache JSONB
  // unpack + one bounded fills aggregation) while giving the realized > 0
  // filter enough survivors to fill both category buckets even when the
  // ratio of realized-winners is low.
  // "Total PnL on this coin position" = booked (`realizedPnlUsd`) +
  // currently riding (`unrealizedPnlUsd`). Matches the convention public
  // trading leaderboards use (Hyperliquid's own, dYdX, copytrade frontends)
  // and is symmetric: a trader who took partial profit + is still up gets
  // full credit; a never-closed paper-winner gets credit too; a trader
  // who's overall net positive after some losses still surfaces. The
  // 20 s page poll cadence keeps the live view honest if a paper-gain
  // position reverses.
  const pool = await getTopOpenPositions(perCategory * 50);
  const winners = pool
    .filter((p) => p.realizedPnlUsd + p.unrealizedPnlUsd > 0)
    .sort(
      (a, b) =>
        b.realizedPnlUsd + b.unrealizedPnlUsd - (a.realizedPnlUsd + a.unrealizedPnlUsd),
    );
  return splitTradesByCategory(winners, perCategory);
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

// ── Most held positions (per-coin holder ranking) ──────────────────────

export interface MostHeldRow {
  /** Fully-qualified coin name (`BTC`, `xyz:NVDA`, …). */
  coin: string;
  /** Distinct tracked traders currently holding any open position on this
   *  coin (long OR short). Primary sort key for the panel. Equal to
   *  `longCount + shortCount` since a trader can only hold one side per
   *  coin at a time on HL. */
  holders: number;
  /** Distinct tracked traders currently long on this coin. */
  longCount: number;
  /** Distinct tracked traders currently short on this coin. */
  shortCount: number;
  /** Σ long − Σ short notional in USD — signed net exposure across the
   *  cohort. Surfaced for context; can color-tint the row. */
  netNotionalUsd: number;
}

export interface CategorizedMostHeld {
  stocks: MostHeldRow[];
  crypto: MostHeldRow[];
}

/**
 * Top-N coins per category by number of tracked traders currently
 * holding an open position. Same JSONB unpack as
 * `getCategoryPositionBreakdown`, just regrouped by coin instead of
 * folded into the category aggregate. Snapshot, not flow — measures
 * what's currently held, not what was opened today. The /analytics
 * panel labels this as "Most Held" between the sentiment cards and
 * the latest-trades / winning-trades grid.
 */
export async function getMostHeldByCategory(
  opts: { perCategory?: number } = {},
): Promise<CategorizedMostHeld> {
  const perCategory = opts.perCategory ?? 5;
  const rows = await db().execute<{
    address: string;
    coin: string;
    szi: string;
    notional: string;
  }>(sql`
    SELECT
      lc.address,
      (p.elem -> 'position' ->> 'coin')           AS coin,
      (p.elem -> 'position' ->> 'szi')            AS szi,
      (p.elem -> 'position' ->> 'positionValue')  AS notional
    FROM leader_cache lc,
         LATERAL jsonb_array_elements(lc.positions_json) AS p(elem)
    WHERE lc.positions_json IS NOT NULL
  `);

  type Bucket = {
    longHolders: Set<string>;
    shortHolders: Set<string>;
    netNotional: number;
  };
  const byCoin: Record<'stocks' | 'crypto', Map<string, Bucket>> = {
    stocks: new Map(),
    crypto: new Map(),
  };
  for (const r of rows.rows) {
    const szi = Number.parseFloat(r.szi);
    if (!Number.isFinite(szi) || szi === 0) continue;
    const notional = Math.abs(Number.parseFloat(r.notional));
    if (!Number.isFinite(notional) || notional === 0) continue;
    const cat = panelCategory(r.coin);
    const b = byCoin[cat].get(r.coin) ?? {
      longHolders: new Set<string>(),
      shortHolders: new Set<string>(),
      netNotional: 0,
    };
    if (szi > 0) {
      b.longHolders.add(r.address);
      b.netNotional += notional;
    } else {
      b.shortHolders.add(r.address);
      b.netNotional -= notional;
    }
    byCoin[cat].set(r.coin, b);
  }

  const topN = (m: Map<string, Bucket>): MostHeldRow[] =>
    Array.from(m.entries())
      .map(([coin, b]) => ({
        coin,
        longCount: b.longHolders.size,
        shortCount: b.shortHolders.size,
        holders: b.longHolders.size + b.shortHolders.size,
        netNotionalUsd: b.netNotional,
      }))
      .sort((a, b) => b.holders - a.holders || Math.abs(b.netNotionalUsd) - Math.abs(a.netNotionalUsd))
      .slice(0, perCategory);

  return { stocks: topN(byCoin.stocks), crypto: topN(byCoin.crypto) };
}
