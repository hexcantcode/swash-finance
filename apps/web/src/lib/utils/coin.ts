/**
 * Same-origin coin-icon URL.
 *
 * Two sources, both served by us:
 * - Per-symbol overrides at `/icons/{SYMBOL}.png` — for coins HL's CDN doesn't
 *   host a logo for. Files live in `apps/web/static/icons/`.
 * - Proxy to HL's CDN at `/coins/{coin}.svg` for everything else — see
 *   `apps/web/src/routes/coins/[coin].svg/+server.ts`. The proxy adds a memory
 *   cache + long Cache-Control headers so we hit `app.hyperliquid.xyz` at most
 *   once per coin per process.
 *
 * Coin mapping rules:
 * - Main perps:  `coin = SYMBOL`              → `/coins/SYMBOL.svg`
 * - HIP-3 perps: `coin = dex:SYMBOL`          → `/coins/dex:SYMBOL.svg`
 * - 1000× tickers (kPEPE, kSHIB, …) reuse the underlying asset's logo since
 *   HL doesn't host the k-prefixed variant.
 */
export function coinIconUrl(coin: string): string {
  const sym = bareSymbol(coin);
  if (COIN_LOGO_OVERRIDES.has(sym)) return `/icons/${sym}.png`;
  let bare = coin.replace(/-?PERP$/i, '');
  if (!bare.includes(':') && /^k[A-Z]/.test(bare)) bare = bare.slice(1);
  return `/coins/${bare}.svg`;
}

/** Extract the bare symbol from a coin string (drops a `dex:` prefix). */
function bareSymbol(coin: string): string {
  const i = coin.indexOf(':');
  return (i === -1 ? coin : coin.slice(i + 1)).toUpperCase();
}

/**
 * Display label for a coin — the bare symbol with original case preserved
 * (so `kPEPE` stays `kPEPE`, not `KPEPE`). Strips a HIP-3 `dex:` prefix to
 * match how rows are labelled in the assets table.
 */
export function coinDisplayName(coin: string): string {
  const i = coin.indexOf(':');
  return i === -1 ? coin : coin.slice(i + 1);
}

/**
 * Logos that HL serves as dark/transparent silhouettes — they disappear into
 * the dark page background unless we put a white disc behind them.
 * Add to this list when a logo audit turns up another offender.
 */
export const COIN_WHITE_BG_SYMBOLS: ReadonlySet<string> = new Set([
  'FARTCOIN', 'INJ', 'ONDO', 'MEGA', 'DYM', 'ADA',
  'SEI', 'AR', 'CTX', 'NIL', '2Z', 'GALA',
  'CC', 'POPCAT', 'CFX',
  'XLM', 'TENCENT', 'WLD', 'XRP', 'NEAR',
]);

/**
 * Symbols we ship a local logo for, served from `apps/web/static/icons/`.
 * Add a file `{SYMBOL}.png` (or `.svg`) under that directory and an entry
 * here — `coinIconUrl` will route to it ahead of the HL CDN proxy.
 */
export const COIN_LOGO_OVERRIDES: ReadonlySet<string> = new Set([
  'NATGAS', 'URNM', 'WHEAT', 'KWEB', 'BIRD', 'CAR',
  'BMNR', 'TENCENT', 'XIAOMI', 'EBAY', 'GAS',
  'USENERGY', 'SEMI', 'MSFT', 'COPPER',
]);

/**
 * Symbols HL's CDN does NOT host AND we don't ship an override for. Broken
 * `<img>`s hide via `onerror`. Kept as data so we can render a styled
 * fallback (initials tile) or short-circuit the upstream fetch later.
 */
export const COIN_KNOWN_NO_LOGO: ReadonlySet<string> = new Set([]);

/** Whether this coin's icon should render on a white disc. */
export function coinNeedsWhiteBg(coin: string): boolean {
  return COIN_WHITE_BG_SYMBOLS.has(bareSymbol(coin));
}

/**
 * Symbols hidden from the assets table entirely. Reasons include: redundant
 * ticker duplicates of a coin already on main under a different name
 * (1000PEPE ≡ main's kPEPE), and HIP-3 listings we've decided not to surface
 * (LIGHTER — but note the unrelated `LIT` perp is kept).
 */
export const COIN_EXCLUDE_SYMBOLS: ReadonlySet<string> = new Set([
  '1000PEPE',
  'PEOPLE',
  'LIGHTER',
  'GLDMINE',
  'BASED',
  'RTX',
  'USDE',
  'WTI',
  'SOY',
]);

/** Whether this coin should be omitted from the assets table. */
export function coinIsExcluded(coin: string): boolean {
  return COIN_EXCLUDE_SYMBOLS.has(bareSymbol(coin));
}

/**
 * Coarse classification for the assets-page filter tabs.
 *
 * Main HL perp dex = always crypto. HIP-3 dexes lean strongly one way: hyna
 * mirrors crypto majors, para lists crypto indices (BTCD, TOTAL2, OTHERS),
 * abcd is crypto-native; everything else (xyz, cash, km, vntl, flx) is
 * TradFi tickers + commodities + indices.
 */
export type CoinCategory = 'crypto' | 'stocks';

const HIP3_CRYPTO_DEXES: ReadonlySet<string> = new Set(['hyna', 'abcd', 'para']);

export function coinCategory(dex: string | null): CoinCategory {
  if (dex === null) return 'crypto';
  return HIP3_CRYPTO_DEXES.has(dex) ? 'crypto' : 'stocks';
}
