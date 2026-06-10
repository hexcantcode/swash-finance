import { hl } from './hl';

/** How often the BFF polls HL for fresh mids. `allMids` is cheap (weight 2). */
const POLL_MS = 1_000;

type Listener = (delta: Record<string, number>) => void;

/**
 * Singleton live mid-price feed.
 *
 * The BFF holds ONE poll loop against Hyperliquid's `allMids` and fans the
 * result out to every SSE subscriber, so browsers never connect to HL directly
 * (the invariant from docs/plans/2026-06-10-mobile-architecture-design.md).
 * Polling runs only while ≥1 subscriber is attached.
 */
class LivePrices {
  #prices: Record<string, number> = {};
  #listeners = new Set<Listener>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #inFlight = false;

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
    void this.#poll();
    this.#timer = setInterval(() => void this.#poll(), POLL_MS);
  }

  #stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#prices = {};
  }

  async #poll() {
    if (this.#inFlight) return; // a slow request is still running; skip this tick
    this.#inFlight = true;
    try {
      const { data } = await hl().allMids();
      const delta: Record<string, number> = {};
      for (const coin in data) {
        const raw = data[coin];
        if (typeof raw !== 'string') continue;
        const px = Number.parseFloat(raw);
        if (!Number.isFinite(px)) continue;
        if (this.#prices[coin] !== px) {
          this.#prices[coin] = px;
          delta[coin] = px;
        }
      }
      if (Object.keys(delta).length > 0) {
        for (const listener of this.#listeners) listener(delta);
      }
    } catch {
      /* transient HL error — the next tick retries */
    } finally {
      this.#inFlight = false;
    }
  }
}

export const livePrices = new LivePrices();
