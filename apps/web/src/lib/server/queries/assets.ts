import { hl } from '../hl.js';

export interface AssetRow {
  /** Fully-qualified coin (bare symbol for the main dex). */
  coin: string;
  /** Bare symbol — used for the logo and the display label. */
  symbol: string;
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

/**
 * All tradable perp assets on HL's main dex, with live price / 24h change /
 * 24h volume / open interest / funding. (HIP-3 builder dexes — Phase 1.5.)
 */
export async function listAssets(): Promise<AssetRow[]> {
  const res = await hl().metaAndAssetCtxs();
  const [meta, ctxs] = res.data;
  const rows: AssetRow[] = [];
  for (let i = 0; i < meta.universe.length; i++) {
    const u = meta.universe[i];
    const c = ctxs[i];
    if (!u || !c || u.isDelisted) continue;
    const markPx = num(c.markPx);
    const prevDayPx = num(c.prevDayPx);
    const oi = num(c.openInterest);
    rows.push({
      coin: u.name,
      symbol: u.name,
      price: markPx,
      change24h:
        markPx !== null && prevDayPx !== null && prevDayPx !== 0
          ? (markPx - prevDayPx) / prevDayPx
          : null,
      volume24h: num(c.dayNtlVlm),
      openInterestUsd: markPx !== null && oi !== null ? oi * markPx : null,
      funding: num(c.funding),
      maxLeverage: u.maxLeverage ?? null,
    });
  }
  return rows;
}
