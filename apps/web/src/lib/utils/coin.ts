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
  'USENERGY', 'SEMI', 'MSFT', 'COPPER', 'SMSN', 'INTC',
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
 * - `index`: any basket/index instrument — broad country indices (SP500,
 *   JP225, …), country/sector ETFs (EWJ, KWEB, XLE, …), vntl sector themes
 *   (BIOTECH, ROBOT, …), and crypto market-cap indices (BTCD, TOTAL2,
 *   OTHERS). Matched by an explicit symbol set so it overrides any
 *   per-dex default.
 * - `crypto`: main HL perp dex + crypto-native HIP-3 dexes (hyna, abcd),
 *   minus anything caught by the index set above.
 * - `stocks`: everything else — individual TradFi tickers (TSLA, NVDA, …),
 *   commodities (GOLD, COPPER, NATGAS, …) and FX (EUR, JPY).
 */
export type CoinCategory = 'crypto' | 'stocks' | 'index';

const HIP3_CRYPTO_DEXES: ReadonlySet<string> = new Set(['hyna', 'abcd', 'para']);

const COIN_INDEX_SYMBOLS: ReadonlySet<string> = new Set([
  // Broad country / region indices
  'JP225', 'KR200', 'SP500', 'US500', 'USA100', 'USA500',
  // Country / region ETFs
  'EWJ', 'EWY', 'EWZ', 'KWEB',
  // US sector indices / ETFs
  'XLE', 'SEMI', 'SEMIS', 'USTECH', 'USENERGY', 'USBOND', 'SMALL2000',
  // vntl sector themes
  'BIOTECH', 'DEFENSE', 'ENERGY', 'INFOTECH', 'MAG7', 'NUCLEAR', 'ROBOT',
  // Other index-like
  'DRAM', 'XYZ100',
  // Crypto market-cap indices
  'BTCD', 'OTHERS', 'TOTAL2',
]);

export function coinCategory(coin: string, dex: string | null): CoinCategory {
  if (COIN_INDEX_SYMBOLS.has(bareSymbol(coin))) return 'index';
  if (dex === null || HIP3_CRYPTO_DEXES.has(dex)) return 'crypto';
  return 'stocks';
}
