import type { RequestHandler } from './$types';
import { sse } from '$lib/server/sse';
import { liveTrades } from '$lib/server/live-trades';

/**
 * SSE stream of the latest trades feed — same `{ ok, latestFills }` shape as
 * GET /api/feed/latest-trades. Full snapshot on connect, then a fresh snapshot
 * whenever new fills land. The BFF polls the DB once and fans out to all
 * subscribers; the client subscribes via EventSource instead of polling.
 */
export const GET: RequestHandler = (event) =>
  sse(event, (send) => {
    const { snapshot, unsubscribe } = liveTrades.subscribe((snap) =>
      send({ ok: true, latestFills: snap }),
    );
    if (snapshot) send({ ok: true, latestFills: snapshot });
    return unsubscribe;
  });
