import { VENUE_ASSETS } from '@copytrade/shared';

/**
 * Lighter market-data WebSocket client (read-only).
 *
 * One `market_stats/all` subscription streams mark/index/mid prices for every
 * Lighter market. We keep ONLY the assets in the cross-venue map
 * (`@copytrade/shared` VENUE_ASSETS) and emit deltas keyed by the **HL coin
 * string** ('BTC', 'kPEPE', 'xyz:SP500') so downstream consumers — the SSE
 * price stream and the mobile UI — keep their existing keys untouched.
 *
 * Protocol notes (verified live 2026-07-05, see
 * docs/plans/2026-07-05-lighter-ws-live-data-plan.md):
 * - subscribe: {"type":"subscribe","channel":"market_stats/all"} → full
 *   snapshot, then incremental updates.
 * - the server drops connections silent for >2 min; the WHATWG WebSocket API
 *   can't send protocol pings, so we re-send the (idempotent) subscribe as an
 *   application-level keepalive frame.
 * - uses the Node ≥20.19 global WebSocket — no ws dependency.
 */

const LIGHTER_WS = 'wss://mainnet.zklighter.elliot.ai/stream?readonly=true';
const KEEPALIVE_MS = 60_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** Lighter symbol → HL coin string, for the mapped (tradeable) assets only. */
const SYMBOL_TO_HL = new Map(VENUE_ASSETS.map((a) => [a.symbol, a.hlCoin]));

interface MarketStats {
  symbol?: string;
  mark_price?: string;
}

type Delta = Record<string, number>;

/**
 * Open the feed. Calls `onDelta` with {hlCoin → markPrice} for mapped assets
 * (full snapshot first, then changes). Returns a stop function. Reconnects
 * itself with exponential backoff until stopped.
 */
export function startLighterPriceFeed(onDelta: (delta: Delta) => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const last: Record<string, number> = {};

  const subscribe = () => {
    ws?.send(JSON.stringify({ type: 'subscribe', channel: 'market_stats/all' }));
  };

  const handleStats = (stats: unknown) => {
    if (!stats || typeof stats !== 'object') return;
    // Updates carry either a single entry or an object keyed by market id.
    const entries: MarketStats[] =
      'symbol' in (stats as MarketStats)
        ? [stats as MarketStats]
        : (Object.values(stats) as MarketStats[]);
    const delta: Delta = {};
    for (const s of entries) {
      const hlCoin = s.symbol !== undefined ? SYMBOL_TO_HL.get(s.symbol) : undefined;
      if (!hlCoin) continue; // unmapped market — out of scope by design
      const px = Number.parseFloat(s.mark_price ?? '');
      if (!Number.isFinite(px) || px <= 0) continue;
      if (last[hlCoin] !== px) {
        last[hlCoin] = px;
        delta[hlCoin] = px;
      }
    }
    if (Object.keys(delta).length > 0) onDelta(delta);
  };

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(LIGHTER_WS);

    ws.onopen = () => {
      attempts = 0;
      subscribe();
      keepalive = setInterval(subscribe, KEEPALIVE_MS);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        if (msg?.market_stats) handleStats(msg.market_stats);
      } catch {
        // malformed frame — ignore
      }
    };

    const scheduleReconnect = () => {
      if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
      if (stopped || reconnectTimer) return;
      const wait = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
      attempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, wait);
    };

    ws.onclose = scheduleReconnect;
    ws.onerror = () => ws?.close();
  };

  connect();

  return () => {
    stopped = true;
    if (keepalive) clearInterval(keepalive);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    ws = null;
  };
}
