import { getLatestTradesByCategory } from './queries/analytics';

/** How often the BFF re-queries the latest-trades feed. Shared across all SSE
 *  subscribers, so one poll regardless of client count. */
const POLL_MS = 3_000;
const PER_CATEGORY = 10;

type Snapshot = Awaited<ReturnType<typeof getLatestTradesByCategory>>;
type Listener = (snapshot: Snapshot) => void;

/**
 * Singleton live trade feed.
 *
 * `apps/worker` writes fills to Postgres; the BFF can't share an in-process
 * event bus with it, so this polls the same `getLatestTradesByCategory` query
 * the REST endpoint uses and pushes a fresh snapshot only when the result
 * actually changes. One poll loop fans out to every SSE subscriber; it runs
 * only while ≥1 subscriber is attached.
 */
class LiveTrades {
  #snapshot: Snapshot | null = null;
  #sig = '';
  #listeners = new Set<Listener>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #inFlight = false;

  /** Attach a listener. Returns the current snapshot (if any) plus unsubscribe. */
  subscribe(onUpdate: Listener): { snapshot: Snapshot | null; unsubscribe: () => void } {
    this.#listeners.add(onUpdate);
    if (this.#listeners.size === 1) this.#start();
    return {
      snapshot: this.#snapshot,
      unsubscribe: () => {
        this.#listeners.delete(onUpdate);
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
    this.#snapshot = null;
    this.#sig = '';
  }

  async #poll() {
    if (this.#inFlight) return;
    this.#inFlight = true;
    try {
      const snap = await getLatestTradesByCategory({ perCategory: PER_CATEGORY });
      const sig = JSON.stringify(snap);
      if (sig !== this.#sig) {
        this.#sig = sig;
        this.#snapshot = snap;
        for (const listener of this.#listeners) listener(snap);
      }
    } catch {
      /* transient DB error — the next tick retries */
    } finally {
      this.#inFlight = false;
    }
  }
}

export const liveTrades = new LiveTrades();
