/**
 * EP-backed rebuilds of the three DB-backed feed endpoints
 * (`/api/feed/latest-trades`, `/api/feed/most-held`,
 * `/api/feed/top-open-positions`). The original `analytics.ts` versions read
 * the `fills` / `leader_cache` / `wallets` tables, which are being dropped in
 * the EP single-roster pivot. These derive the SAME response shapes from the
 * EP module's Hyperdash data so the mobile feed client keeps working unchanged.
 *
 * Fields with no Hyperdash source are defaulted (see per-mapping notes) rather
 * than renamed/dropped — the mobile client reads every field below.
 */

import { coinCategory } from '$lib/utils/coin';
import { getEpPositions, type MarketPositions, type SmartPosition } from './positions.js';
import { getEpTrades, type SmartTrade } from './trades.js';

// ── Shared category split (folds 'index' into 'stocks', matching analytics) ──

function panelCategory(coin: string): 'stocks' | 'crypto' {
  const colonIdx = coin.indexOf(':');
  const dex = colonIdx === -1 ? null : coin.slice(0, colonIdx);
  return coinCategory(coin, dex) === 'crypto' ? 'crypto' : 'stocks';
}

// ── latest-trades (← getEpTrades) ───────────────────────────────────────────

/** Same shape as analytics' `LatestTrade` / mobile's `LatestFill`. */
export interface LatestFill {
  key: string;
  address: string;
  coin: string;
  side: 'A' | 'B';
  fillCount: number;
  szBase: number;
  notionalUsd: number;
  vwapUsd: number;
  blockTimeMs: number;
  leverage: number | null;
}

export interface CategorizedLatestTrades {
  stocks: LatestFill[];
  crypto: LatestFill[];
}

/** Map one EP completed trade to a latest-trades row.
 *  - `key`: synthesized (no oid/tid in Hyperdash) — stable per trade.
 *  - `side`: 'Long' → 'B' (buy), else 'A' (sell) — closest to fill buy/sell.
 *  - `vwapUsd`: EP entry price (Hyperdash gives no per-fill VWAP).
 *  - `fillCount`: 1 (Hyperdash reports the round-trip, not constituent fills).
 *  - `leverage`: null (no Hyperdash source). */
function toLatestFill(t: SmartTrade): LatestFill {
  return {
    key: `${t.address}|${t.coin}|${t.closedAtMs}|${t.direction}`,
    address: t.address,
    coin: t.coin,
    side: t.direction.toLowerCase() === 'long' ? 'B' : 'A',
    fillCount: 1,
    szBase: t.szBase,
    notionalUsd: t.notionalUsd,
    vwapUsd: t.entryPxUsd,
    blockTimeMs: t.closedAtMs,
    leverage: null,
  };
}

export async function getEpLatestTradesByCategory(
  opts: { perCategory?: number } = {},
): Promise<CategorizedLatestTrades> {
  const perCategory = opts.perCategory ?? 10;
  const trades = await getEpTrades(); // already newest-first
  const stocks: LatestFill[] = [];
  const crypto: LatestFill[] = [];
  for (const t of trades) {
    const row = toLatestFill(t);
    if (panelCategory(t.coin) === 'stocks') {
      if (stocks.length < perCategory) stocks.push(row);
    } else if (crypto.length < perCategory) crypto.push(row);
    if (stocks.length >= perCategory && crypto.length >= perCategory) break;
  }
  return { stocks, crypto };
}

// ── most-held (← getEpPositions) ─────────────────────────────────────────────

/** Same shape as analytics' / mobile's `MostHeldRow`. */
export interface MostHeldRow {
  coin: string;
  holders: number;
  longCount: number;
  shortCount: number;
  netNotionalUsd: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
}

export interface CategorizedMostHeld {
  stocks: MostHeldRow[];
  crypto: MostHeldRow[];
}

function toMostHeldRow(m: MarketPositions): MostHeldRow {
  return {
    coin: m.coin,
    holders: m.longCount + m.shortCount,
    longCount: m.longCount,
    shortCount: m.shortCount,
    netNotionalUsd: m.longNotionalUsd - m.shortNotionalUsd,
    longNotionalUsd: m.longNotionalUsd,
    shortNotionalUsd: m.shortNotionalUsd,
  };
}

export async function getEpMostHeldByCategory(
  opts: { perCategory?: number } = {},
): Promise<CategorizedMostHeld> {
  const perCategory = opts.perCategory ?? 8;
  const markets = await getEpPositions();
  const stocks: MostHeldRow[] = [];
  const crypto: MostHeldRow[] = [];
  for (const m of markets) {
    const bucket = panelCategory(m.coin) === 'stocks' ? stocks : crypto;
    bucket.push(toMostHeldRow(m));
  }
  const byHolders = (a: MostHeldRow, b: MostHeldRow) =>
    b.holders - a.holders || Math.abs(b.netNotionalUsd) - Math.abs(a.netNotionalUsd);
  return {
    stocks: stocks.sort(byHolders).slice(0, perCategory),
    crypto: crypto.sort(byHolders).slice(0, perCategory),
  };
}

// ── top-open-positions (← getEpPositions, flattened) ─────────────────────────

/** Same shape as analytics' `TopOpenPosition` / mobile's `TopOpenPosition`.
 *  Fields with no Hyperdash source are nulled (mobile types them nullable):
 *  `returnOnEquity`, `leverage`, `liquidationPxUsd`, `realizedPnlUsd`. */
export interface TopOpenPosition {
  address: string;
  coin: string;
  side: 'long' | 'short';
  szBase: number;
  entryPxUsd: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  returnOnEquity: number | null;
  leverage: number | null;
  liquidationPxUsd: number | null;
  lastRefreshedAtMs: number;
  realizedPnlUsd: number | null;
}

export interface CategorizedTopOpenPositions {
  stocks: TopOpenPosition[];
  crypto: TopOpenPosition[];
}

export async function getEpTopOpenPositionsByCategory(
  opts: { perCategory?: number } = {},
): Promise<CategorizedTopOpenPositions> {
  const perCategory = opts.perCategory ?? 10;
  const markets = await getEpPositions();
  const nowMs = Date.now();

  // Flatten every market's per-trader positions into individual rows, then
  // rank by notional (the "biggest open positions" the panel surfaces).
  const flat: { coin: string; pos: SmartPosition }[] = [];
  for (const m of markets) for (const pos of m.positions) flat.push({ coin: m.coin, pos });
  flat.sort((a, b) => b.pos.notionalUsd - a.pos.notionalUsd);

  const stocks: TopOpenPosition[] = [];
  const crypto: TopOpenPosition[] = [];
  for (const { coin, pos } of flat) {
    const row: TopOpenPosition = {
      address: pos.address,
      coin,
      side: pos.side,
      szBase: pos.szBase,
      entryPxUsd: pos.entryPxUsd,
      notionalUsd: pos.notionalUsd,
      unrealizedPnlUsd: pos.unrealizedPnlUsd,
      returnOnEquity: null,
      leverage: null,
      liquidationPxUsd: null,
      lastRefreshedAtMs: nowMs,
      realizedPnlUsd: null,
    };
    if (panelCategory(coin) === 'stocks') {
      if (stocks.length < perCategory) stocks.push(row);
    } else if (crypto.length < perCategory) crypto.push(row);
    if (stocks.length >= perCategory && crypto.length >= perCategory) break;
  }
  return { stocks, crypto };
}
