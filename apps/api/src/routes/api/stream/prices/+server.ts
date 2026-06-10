import type { RequestHandler } from './$types';
import { sse } from '$lib/server/sse';
import { livePrices } from '$lib/server/live-prices';

/**
 * SSE stream of live mark prices (coin → number).
 *
 * On connect the client receives a full snapshot, then a delta object whenever
 * any mid changes. Replaces the browser's old direct Hyperliquid WebSocket so
 * the client only ever talks to the BFF.
 */
export const GET: RequestHandler = (event) =>
  sse(event, (send) => {
    const { snapshot, unsubscribe } = livePrices.subscribe((delta) => send(delta));
    if (Object.keys(snapshot).length > 0) send(snapshot);
    return unsubscribe;
  });
