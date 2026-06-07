/*
 * Shared live mark-price feed — mirrors the desktop web flash behavior.
 *
 * The browser subscribes once to Hyperliquid's `allMids` WS channel (a fresh
 * mark price for every coin every ~few hundred ms). A single socket fans out
 * to every subscriber (home + assets lists) via refcount, so we never open
 * one connection per page. On each price change we emit a brief up/down
 * `flash` signal keyed by coin; `MobileAssetRow` reads `prices`/`flashes`
 * reactively and tints the row green/red.
 *
 * Canonical price still comes from `apps/web`'s `/api/assets` (the loaded
 * `Asset.price`); this only overlays the live mid on top for display.
 */

import { browser } from '$app/environment';

type Flash = { dir: 'up' | 'down'; n: number };

const HL_WS = 'wss://api.hyperliquid.xyz/ws';
/** How long a row stays tinted after its last price change. */
const FLASH_MS = 700;
/** Reconnect backoff after an unexpected socket close. */
const RECONNECT_MS = 2_000;

class LiveFeed {
  /** coin → latest live mark price. Mutated in place; readers track per-coin. */
  prices = $state<Record<string, number>>({});
  /** coin → active flash. `n` ticks up on each change so the animation can
   *  retrigger even when consecutive ticks share direction. */
  flashes = $state<Record<string, Flash>>({});

  #ws: WebSocket | null = null;
  #refs = 0;
  #last = new Map<string, number>();
  #flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Open (or join) the shared socket. Returns an unsubscribe that closes it
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
    if (!browser || this.#ws) return;
    const ws = new WebSocket(HL_WS);
    this.#ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
    };
    ws.onmessage = (ev) => this.#onMessage(ev);
    ws.onclose = () => {
      if (this.#ws !== ws) return; // already torn down / replaced
      this.#ws = null;
      this.#reconnectTimer = setTimeout(() => {
        this.#reconnectTimer = null;
        if (this.#refs > 0) this.#connect();
      }, RECONNECT_MS);
    };
    ws.onerror = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
  }

  #onMessage(ev: MessageEvent) {
    let msg: unknown;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return;
    }
    if (
      typeof msg !== 'object' ||
      msg === null ||
      (msg as { channel?: unknown }).channel !== 'allMids'
    ) {
      return;
    }
    const mids = (msg as { data?: { mids?: Record<string, string> } }).data?.mids;
    if (!mids) return;

    for (const coin in mids) {
      const raw = mids[coin];
      if (typeof raw !== 'string') continue;
      const px = Number.parseFloat(raw);
      if (!Number.isFinite(px)) continue;
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
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    for (const t of this.#flashTimers.values()) clearTimeout(t);
    this.#flashTimers.clear();
    this.flashes = {};
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try { ws.close(); } catch { /* ignore */ }
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
