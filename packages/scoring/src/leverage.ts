/**
 * Historical leverage profile, reconstructed from a wallet's fill stream.
 *
 * For each fill we know the position the wallet *held* right before it
 * (`startPosition`, in coin units) and the trade size/side, so the position
 * *after* the fill is `startPosition ± sz` — self-contained per fill, which
 * makes this robust to gaps in the ingested history. At every fill we recompute
 * the gross notional position (Σ over coins of |position · last-seen-price|) and
 * divide by the account value; we only sample when a position is actually open
 * (gross > 0) — so a wallet that's flat 90% of the time and 20× the other 10%
 * reads as ~20×, not ~0.
 *
 * The account value is the single "now" figure (`wallets.accountValue`); a
 * wallet that deposited/withdrew a lot makes this approximate, but for "does
 * this person trade with degen leverage" it's a solid signal.
 */

export interface LeverageFill {
  blockTimeMs: number;
  coin: string;
  side: 'B' | 'A';
  /** fill price (USD per coin unit), as a numeric string. */
  px: string;
  /** fill size (coin units), as a numeric string. */
  sz: string;
  /** the wallet's position in this coin *before* this fill (coin units, signed),
   *  as a numeric string; null/unparseable ⇒ that fill is skipped. */
  startPosition: string | null;
}

export interface LeverageProfile {
  /** median gross account leverage across the moments a position was open. */
  typicalGross: number;
  /** the single highest gross account leverage observed. */
  maxGross: number;
  /** mean gross account leverage across the open-position moments. */
  avgGross: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function computeLeverageProfile(
  fills: LeverageFill[],
  accountValueUsd: number | null,
): LeverageProfile | null {
  if (accountValueUsd == null || !Number.isFinite(accountValueUsd) || accountValueUsd <= 0) {
    return null;
  }
  if (fills.length === 0) return null;

  const ordered = [...fills].sort((a, b) => a.blockTimeMs - b.blockTimeMs);
  const positionByCoin = new Map<string, number>(); // signed size, coin units
  const lastPxByCoin = new Map<string, number>();
  const leverages: number[] = [];

  for (const fill of ordered) {
    const px = Number.parseFloat(fill.px);
    const sz = Number.parseFloat(fill.sz);
    const startPos = Number.parseFloat(fill.startPosition ?? '');
    if (!Number.isFinite(px) || !Number.isFinite(sz) || !Number.isFinite(startPos)) continue;

    const posAfter = startPos + (fill.side === 'B' ? sz : -sz);
    positionByCoin.set(fill.coin, posAfter);
    lastPxByCoin.set(fill.coin, px);

    let gross = 0;
    for (const [coin, pos] of positionByCoin) {
      const cpx = lastPxByCoin.get(coin);
      if (cpx === undefined) continue; // no price seen yet for this coin
      gross += Math.abs(pos) * cpx;
    }
    const lev = gross / accountValueUsd;
    if (Number.isFinite(lev) && lev > 0) leverages.push(lev);
  }

  if (leverages.length === 0) return null;
  return {
    typicalGross: median(leverages),
    maxGross: Math.max(...leverages),
    avgGross: leverages.reduce((a, b) => a + b, 0) / leverages.length,
  };
}
