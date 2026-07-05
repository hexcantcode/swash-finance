import { VENUE_ASSETS } from '@copytrade/shared';

/**
 * The `/assets` index — **Lighter-sourced**: the tradeable (cross-venue
 * mapped) markets with Lighter's prices, since Lighter is the execution
 * venue and its numbers are the tradeable truth. One row per mapped asset;
 * HL-only markets are deliberately absent (analytics for them remain
 * reachable, but the index follows what's executable).
 *
 * Field mapping from Lighter `/api/v1/orderBookDetails` (one call, cached):
 * price ← last_trade_price · change24h ← daily_price_change (% → decimal) ·
 * volume24h ← daily_quote_token_volume · openInterestUsd ← open_interest
 * (base units) × price · maxLeverage ← 10000 / min_initial_margin_fraction.
 * Funding isn't in the REST payload — null (the WS market_stats channel has
 * it if a surface ever needs it live).
 *
 * `coin` stays the HL coin string ('BTC', 'kPEPE', 'xyz:SP500') — it's the
 * key every analytics endpoint and detail route uses. `symbol` is Lighter's
 * canonical symbol ('1000PEPE', 'US500'), which is also the display label.
 */

export interface AssetRow {
  /** HL coin string — the analytics/detail-route key. */
  coin: string;
  /** Lighter's canonical symbol — used for the logo and the display label. */
  symbol: string;
  /** Source dex of the HL analytics side (null = main perp dex). */
  dex: string | null;
  /** Lighter last trade price (USD). */
  price: number | null;
  /** 24h price change as a decimal (0.05 = +5%). */
  change24h: number | null;
  /** 24h notional volume (USD). */
  volume24h: number | null;
  /** open interest in USD (open interest in coin units × price). */
  openInterestUsd: number | null;
  /** funding rate per hour (decimal). Not exposed by Lighter's REST details. */
  funding: number | null;
  /** max leverage. */
  maxLeverage: number | null;
}

const LIGHTER_DETAILS_URL = 'https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails';
const ASSET_ROWS_TTL_MS = 30_000;

interface OrderBookDetails {
  symbol: string;
  status: string;
  market_type: string;
  last_trade_price?: number | string;
  daily_price_change?: number | string;
  daily_quote_token_volume?: number | string;
  open_interest?: number | string;
  min_initial_margin_fraction?: number | string;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

let assetRowsCache: { data: AssetRow[]; expiresAt: number } | null = null;
let assetRowsInflight: Promise<AssetRow[]> | null = null;

async function fetchAssetRows(): Promise<AssetRow[]> {
  if (assetRowsCache && assetRowsCache.expiresAt > Date.now()) return assetRowsCache.data;
  if (assetRowsInflight) return assetRowsInflight;
  const promise = fetchAssetRowsUncached();
  assetRowsInflight = promise;
  try {
    const data = await promise;
    assetRowsCache = { data, expiresAt: Date.now() + ASSET_ROWS_TTL_MS };
    return data;
  } catch (err) {
    // Serve the last good list on upstream blips rather than blanking /assets.
    if (assetRowsCache) return assetRowsCache.data;
    throw err;
  } finally {
    if (assetRowsInflight === promise) assetRowsInflight = null;
  }
}

async function fetchAssetRowsUncached(): Promise<AssetRow[]> {
  const res = await fetch(LIGHTER_DETAILS_URL);
  if (!res.ok) throw new Error(`lighter orderBookDetails ${res.status}`);
  const json = (await res.json()) as { order_book_details?: OrderBookDetails[] };
  const bySymbol = new Map(
    (json.order_book_details ?? [])
      .filter((d) => d.status === 'active' && d.market_type === 'perp')
      .map((d) => [d.symbol, d]),
  );

  const rows: AssetRow[] = [];
  for (const a of VENUE_ASSETS) {
    const d = bySymbol.get(a.symbol);
    if (!d) continue; // listing gone on Lighter — drop rather than show stale
    const price = num(d.last_trade_price);
    const changePct = num(d.daily_price_change);
    const oiBase = num(d.open_interest);
    const imf = num(d.min_initial_margin_fraction);
    rows.push({
      coin: a.hlCoin,
      symbol: a.symbol,
      dex: a.hlCoin.includes(':') ? a.hlCoin.slice(0, a.hlCoin.indexOf(':')) : null,
      price,
      change24h: changePct === null ? null : changePct / 100,
      volume24h: num(d.daily_quote_token_volume),
      openInterestUsd: price !== null && oiBase !== null ? oiBase * price : null,
      funding: null,
      maxLeverage: imf !== null && imf > 0 ? Math.round(10_000 / imf) : null,
    });
  }
  rows.sort((x, y) => (y.volume24h ?? 0) - (x.volume24h ?? 0));
  return rows;
}

/** The tradeable asset list, one row per mapped market, volume-descending. */
export async function listAssets(): Promise<AssetRow[]> {
  return fetchAssetRows();
}
