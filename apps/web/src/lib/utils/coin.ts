/** HL's own coin-icon CDN. For HIP-3 coins (`dex:SYMBOL`) we use the bare symbol. */
export function coinIconUrl(coin: string): string {
  const symbol = coin.includes(':') ? (coin.split(':')[1] ?? coin) : coin;
  const bare = symbol.replace(/-?PERP$/i, '');
  return `https://app.hyperliquid.xyz/coins/${bare}.svg`;
}
