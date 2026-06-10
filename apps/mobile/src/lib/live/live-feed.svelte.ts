/*
 * Shared live mark-price feed — mirrors the desktop web flash behavior.
 *
 * The browser subscribes once to the BFF's `/api/stream/prices` SSE endpoint,
 * which holds a single Hyperliquid `allMids` poll loop and fans fresh mids out
 * to every client. A single EventSource fans out to every subscriber (home +
 * assets lists) via refcount, so we never open one connection per page. The
 * client never talks to Hyperliquid directly — that's the BFF's job. On each
 * price change we emit a brief up/down `flash` signal keyed by coin;
 * `MobileAssetRow` reads `prices`/`flashes` reactively and tints the row.
 *
 * Each SSE message is a `{ coin: price }` object: the first is a full snapshot,
 * the rest are deltas of changed coins. Canonical price still comes from the
 * BFF's `/api/assets` (the loaded `Asset.price`); this overlays the live mid.
 */

import { browser } from '$app/environment';
import { apiUrl } from '$lib/api/client';

type Flash = { dir: 'up' | 'down'; n: number };

/** How long a row stays tinted after its last price change. */
const FLASH_MS = 700;

class LiveFeed {
  /** coin → latest live mark price. Mutated in place; readers track per-coin. */
  prices = $state<Record<string, number>>({});
  /** coin → active flash. `n` ticks up on each change so the animation can
   *  retrigger even when consecutive ticks share direction. */
  flashes = $state<Record<string, Flash>>({});

  #es: EventSource | null = null;
  #refs = 0;
  #last = new Map<string, number>();
  #flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Open (or join) the shared stream. Returns an unsubscribe that closes it
   *  once the last subscriber leaves. */
  subscribe(): () => void {
    this.#refs++;
    if (this.#refs === 1) this.#connect();
    return () => {
      this.#refs--;
      if (this.#refs === 0) this.#teardown();
    };
  }

  #connect() {
    if (!browser || this.#es) return;
    // EventSource reconnects automatically on drop; on reconnect the server
    // re-sends a snapshot, so there's no manual retry logic to maintain.
    const es = new EventSource(apiUrl('/api/stream/prices'));
    this.#es = es;
    es.onmessage = (ev) => this.#onMessage(ev);
  }

  #onMessage(ev: MessageEvent) {
    let mids: unknown;
    try {
      mids = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return;
    }
    if (typeof mids !== 'object' || mids === null) return;

    for (const coin in mids as Record<string, unknown>) {
      const px = (mids as Record<string, number>)[coin];
      if (typeof px !== 'number' || !Number.isFinite(px)) continue;
      const prev = this.#last.get(coin);
      if (prev !== undefined && px !== prev) {
        const dir: 'up' | 'down' = px > prev ? 'up' : 'down';
        this.flashes[coin] = { dir, n: (this.flashes[coin]?.n ?? 0) + 1 };
        const t = this.#flashTimers.get(coin);
        if (t) clearTimeout(t);
        this.#flashTimers.set(
          coin,
          setTimeout(() => {
            delete this.flashes[coin];
            this.#flashTimers.delete(coin);
          }, FLASH_MS),
        );
      }
      this.#last.set(coin, px);
      this.prices[coin] = px;
    }
  }

  #teardown() {
    for (const t of this.#flashTimers.values()) clearTimeout(t);
    this.#flashTimers.clear();
    this.flashes = {};
    const es = this.#es;
    this.#es = null;
    if (es) {
      es.onmessage = null;
      try { es.close(); } catch { /* ignore */ }
    }
  }
}

export const liveFeed = new LiveFeed();

/** Live 24h change for an asset, recomputed off the live mid against the
 *  previous-day reference implied by the loaded `price`/`change24h`. Falls
 *  back to the loaded `change24h` when there's no live tick yet. */
export function liveChange24h(
  loadedPrice: number | null,
  loadedChange24h: number | null,
  live: number | undefined,
): number | null {
  if (live === undefined || loadedPrice === null || loadedChange24h === null) {
    return loadedChange24h;
  }
  const prevDayPx = loadedPrice / (1 + loadedChange24h);
  if (!Number.isFinite(prevDayPx) || prevDayPx === 0) return loadedChange24h;
  return (live - prevDayPx) / prevDayPx;
}
