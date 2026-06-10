import { error } from '@sveltejs/kit';
import { tryNormalizeAddress } from '@copytrade/shared';
import { getLiveSlice } from '$lib/server/queries/leader-detail';
import { sse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

/** How often the BFF re-reads the trader's volatile slice (positions + recent
 *  fills) from the DB. Per-connection poll — trader-page concurrency is low, so
 *  no shared singleton is warranted. Pure DB read, like GET /trader/[address]/live. */
const POLL_MS = 4_000;

/**
 * SSE stream of a trader's live slice — same shape as GET /trader/[address]/live
 * ({ open_positions, recent_fills, live_refreshed_at, live_source }). Snapshot on
 * connect, then a fresh slice whenever positions/fills change. Replaces the page
 * having to poll the REST endpoint itself.
 */
export const GET: RequestHandler = (event) => {
  const address = tryNormalizeAddress(event.params.address);
  if (!address) throw error(400, 'Invalid Ethereum address');

  return sse(event, (send) => {
    let sig = '';
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const live = await getLiveSlice(address);
        if (live) {
          const next = JSON.stringify(live);
          if (next !== sig) {
            sig = next;
            send(live);
          }
        }
      } catch {
        /* transient DB error — the next tick retries */
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  });
};
