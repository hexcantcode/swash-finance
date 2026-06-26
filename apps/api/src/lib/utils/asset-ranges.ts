// Constants + types shared by the asset detail page (browser) and the
// server-only query layer. Lives outside `$lib/server/` so the .svelte page
// can import the value constants without tripping SvelteKit's server-only
// boundary check.

/** Range key used by `/assets/[coin]` — surfaced in the URL as `?range=…`.
 *  `all` is the full available history (daily candles). */
export type RangeKey = '1h' | '4h' | '1d' | '7d' | '30d' | 'all';

export const RANGE_KEYS = ['1h', '4h', '1d', '7d', '30d', 'all'] as const satisfies readonly RangeKey[];

export const DEFAULT_RANGE: RangeKey = '1d';

export function parseRange(raw: string | null | undefined): RangeKey {
  return (RANGE_KEYS as readonly string[]).includes(raw ?? '')
    ? (raw as RangeKey)
    : DEFAULT_RANGE;
}

/** One OHLCV point from HL `candleSnapshot`, mapped to numbers. */
export interface CandlePoint {
  /** open timestamp, ms */
  t: number;
  o: number;
  c: number;
  h: number;
  l: number;
  /** volume in base currency */
  v: number;
}

/** A single "position open" event surfaced on the chart as an avatar marker.
 *  `side` is the *opening* fill's side: 'B' = opened long (green ring),
 *  'A' = opened short (red ring). */
export interface TraderOpen {
  address: string;
  blockTimeMs: number;
  side: 'B' | 'A';
  pxUsd: number;
}

/** Top-traders row for the asset detail page. */
export interface TopTrader {
  address: string;
  totalPnlUsd: number;
  /** count of fills with non-zero closed_pnl on this coin */
  tradeCount: number;
  /** SUM(closed_pnl) / SUM(|sz·px|) over closing fills. Decimal (0.125 = +12.5%).
   *  Approximate "PnL per dollar of notional closed-out on this asset" —
   *  null if there's no measurable closed notional. */
  roi: number | null;
}
