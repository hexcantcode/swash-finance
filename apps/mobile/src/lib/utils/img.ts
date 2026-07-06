/**
 * Hide an <img> whose source failed to load (e.g. a coin logo the HL CDN
 * doesn't host). Used for stacked mini-avatars where a text fallback doesn't
 * fit; larger single icons use the CoinIcon component's initials tile instead.
 */
export function hideBrokenImg(e: Event): void {
  (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
}
