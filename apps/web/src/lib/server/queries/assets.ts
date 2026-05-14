import { coinIsExcluded } from '$lib/utils/coin';
import { hl } from '../hl.js';

export interface AssetRow {
  /** Fully-qualified coin (bare symbol for the main dex, `dex:SYMBOL` for HIP-3). */
  coin: string;
  /** Bare symbol — used for the logo and the display label. */
  symbol: string;
  /** Source dex name (null = main perp dex, otherwise the HIP-3 builder dex). */
  dex: string | null;
  /** mark price (USD). */
  price: number | null;
  /** 24h price change as a decimal (0.05 = +5%). */
  change24h: number | null;
  /** 24h notional volume (USD). */
  volume24h: number | null;
  /** open interest in USD (open interest in coin units × mark price). */
  openInterestUsd: number | null;
  /** funding rate per hour (decimal). */
  funding: number | null;
  /** max leverage. */
  maxLeverage: number | null;
}

function num(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

type UniverseItem = { name: string; maxLeverage?: number; isDelisted?: boolean };
type AssetCtx = {
  markPx?: string | null;
  prevDayPx?: string | null;
  dayNtlVlm?: string | null;
  openInterest?: string | null;
  funding?: string | null;
};

function toRow(coin: string, symbol: string, dex: string | null, u: UniverseItem, c: AssetCtx): AssetRow {
  const markPx = num(c.markPx);
  const prevDayPx = num(c.prevDayPx);
  const oi = num(c.openInterest);
  return {
    coin,
    symbol,
    dex,
    price: markPx,
    change24h:
      markPx !== null && prevDayPx !== null && prevDayPx !== 0
        ? (markPx - prevDayPx) / prevDayPx
        : null,
    volume24h: num(c.dayNtlVlm),
    openInterestUsd: markPx !== null && oi !== null ? oi * markPx : null,
    funding: num(c.funding),
    maxLeverage: u.maxLeverage ?? null,
  };
}

/**
 * The raw set of HL perp markets — main dex *plus* every HIP-3 builder dex,
 * emitted one row per `(dex, coin)`. HIP-3 coins are qualified as
 * `dex:SYMBOL` in `row.coin` with the bare ticker in `row.symbol`. No
 * dedup; if `cash:TSLA` and `xyz:TSLA` both exist, both appear.
 *
 * This is the single underlying fetch — both `listAssets()` (deduped, for
 * the `/assets` index) and `listAllAssetsRaw()` (un-deduped, for the
 * analytics position matrix that needs to match `leader_cache` positions
 * keyed by the qualified coin) call into this.
 */
async function fetchAllAssetRows(): Promise<AssetRow[]> {
  const client = hl();
  const [mainRes, dexsRes] = await Promise.all([
    client.metaAndAssetCtxs(),
    client.perpDexs(),
  ]);

  const rows: AssetRow[] = [];
  const [mainMeta, mainCtxs] = mainRes.data;
  for (let i = 0; i < mainMeta.universe.length; i++) {
    const u = mainMeta.universe[i];
    const c = mainCtxs[i];
    if (!u || !c || u.isDelisted) continue;
    if (coinIsExcluded(u.name)) continue;
    rows.push(toRow(u.name, u.name, null, u, c));
  }

  const dexNames = dexsRes.data.flatMap((d) => (d ? [d.name] : []));
  const hip3 = await Promise.all(
    dexNames.map((name) =>
      client.metaAndAssetCtxs({ dex: name }).catch(() => null),
    ),
  );
  hip3.forEach((res, idx) => {
    if (!res) return;
    const dexName = dexNames[idx];
    if (!dexName) return;
    const [meta, ctxs] = res.data;
    for (let i = 0; i < meta.universe.length; i++) {
      const u = meta.universe[i];
      const c = ctxs[i];
      if (!u || !c || u.isDelisted) continue;
      if (coinIsExcluded(u.name)) continue;
      // HL returns HIP-3 universe entries already qualified (e.g. `xyz:TSLA`).
      // Don't re-prefix: just split out the bare symbol for the display label.
      const colon = u.name.indexOf(':');
      const symbol = colon === -1 ? u.name : u.name.slice(colon + 1);
      rows.push(toRow(u.name, symbol, dexName, u, c));
    }
  });

  return rows;
}

/**
 * Deduped asset rows — single row per bare symbol, highest-volume listing
 * wins (main-dex wins ties). For the `/assets` index page where the user
 * wants one row per ticker. HIP-3 builder dexes commonly re-list main-dex
 * coins (hyna:BTC, hyna:ETH) and compete with each other on TradFi tickers
 * (TSLA across xyz/cash/km/flx) — this surface chooses the deepest market.
 */
export async function listAssets(): Promise<AssetRow[]> {
  const rows = await fetchAllAssetRows();
  const winners = new Map<string, AssetRow>();
  for (const row of rows) {
    const incumbent = winners.get(row.symbol);
    if (!incumbent) {
      winners.set(row.symbol, row);
      continue;
    }
    const a = row.volume24h ?? 0;
    const b = incumbent.volume24h ?? 0;
    if (a > b) winners.set(row.symbol, row);
    else if (a === b && row.dex === null) winners.set(row.symbol, row);
  }
  return [...winners.values()];
}

/**
 * Un-deduped raw asset rows — every `(dex, coin)` pair across main + HIP-3.
 * The analytics page's position matrix uses this because `leader_cache`
 * positions are keyed by the qualified coin (`cash:TSLA`, not `TSLA`), so
 * matching against the deduped view would silently miss HIP-3 positions
 * whose dex didn't win the volume tie-break.
 */
export async function listAllAssetsRaw(): Promise<AssetRow[]> {
  return fetchAllAssetRows();
}
