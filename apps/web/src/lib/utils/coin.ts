/**
 * Local same-origin proxy to HL's coin-icon CDN — see
 * `apps/web/src/routes/coins/[coin].svg/+server.ts`. Going through the proxy
 * means the SVGs ride our own Cache-Control headers and a process-local memory
 * cache, instead of hitting `app.hyperliquid.xyz` on every render.
 *
 * Coin mapping rules applied here (not in the proxy, so the proxy stays dumb):
 * - Main perps:  `coin = SYMBOL`              → `/coins/SYMBOL.svg`
 * - HIP-3 perps: `coin = dex:SYMBOL`          → `/coins/dex:SYMBOL.svg`
 * - 1000× tickers (kPEPE, kSHIB, …) reuse the underlying asset's logo since
 *   HL doesn't host the k-prefixed variant.
 */
export function coinIconUrl(coin: string): string {
  let bare = coin.replace(/-?PERP$/i, '');
  if (!bare.includes(':') && /^k[A-Z]/.test(bare)) bare = bare.slice(1);
  return `/coins/${bare}.svg`;
}
