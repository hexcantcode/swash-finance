import { startLighterPriceFeed } from './lighter-ws';

type Listener = (delta: Record<string, number>) => void;

/**
 * Singleton live mark-price feed.
 *
 * Sourced from the **Lighter** WebSocket (`market_stats/all`) — the execution
 * venue's prices are the tradeable truth — restricted to the cross-venue
 * mapped assets and keyed by HL coin strings, so the SSE contract and every
 * UI consumer are unchanged from the old HL-poll era. Unmapped HL-only coins
 * no longer stream (they keep their REST prices at page load) — deliberate:
 * the live ticker follows what's executable.
 *
 * The BFF holds ONE upstream socket and fans deltas out to every SSE
 * subscriber (browsers never talk to a venue directly). The socket runs only
 * while ≥1 subscriber is attached.
 */
class LivePrices {
  #prices: Record<string, number> = {};
  #listeners = new Set<Listener>();
  #stopFeed: (() => void) | null = null;

  /** Attach a listener. Returns the current snapshot plus an unsubscribe. */
  subscribe(onDelta: Listener): { snapshot: Record<string, number>; unsubscribe: () => void } {
    this.#listeners.add(onDelta);
    if (this.#listeners.size === 1) this.#start();
    return {
      snapshot: { ...this.#prices },
      unsubscribe: () => {
        this.#listeners.delete(onDelta);
        if (this.#listeners.size === 0) this.#stop();
      },
    };
  }

  #start() {
    this.#stopFeed = startLighterPriceFeed((delta) => {
      Object.assign(this.#prices, delta);
      for (const listener of this.#listeners) listener(delta);
    });
  }

  #stop() {
    this.#stopFeed?.();
    this.#stopFeed = null;
    this.#prices = {};
  }
}

export const livePrices = new LivePrices();
