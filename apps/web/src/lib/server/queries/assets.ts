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
 * All tradable perp assets on HL's main dex plus every HIP-3 builder dex, with
 * live price / 24h change / 24h volume / open interest / funding. HIP-3 coins
 * are emitted as `dex:SYMBOL` in `coin` and the bare ticker in `symbol`.
 */
export async function listAssets(): Promise<AssetRow[]> {
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
      // HL returns HIP-3 universe entries already qualified (e.g. `xyz:TSLA`).
      // Don't re-prefix: just split out the bare symbol for the display label.
      const colon = u.name.indexOf(':');
      const symbol = colon === -1 ? u.name : u.name.slice(colon + 1);
      rows.push(toRow(u.name, symbol, dexName, u, c));
    }
  });

  // Dedup cross-dex duplicates: HIP-3 builder dexes commonly re-list main-dex
  // coins (hyna:BTC, hyna:ETH, …) and compete with each other on TradFi
  // tickers (TSLA across xyz/cash/km/flx). Keep only the listing with the
  // highest 24h notional volume per bare symbol so the table reflects where
  // liquidity actually is. Null volume sorts as 0; main dex wins ties.
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
