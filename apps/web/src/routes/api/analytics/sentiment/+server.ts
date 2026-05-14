import { json } from '@sveltejs/kit';
import { getCategoryPositionBreakdown } from '$lib/server/queries/analytics';
import type { RequestHandler } from './$types';

/**
 * Lightweight endpoint for the /analytics page's "Tracked sentiment" cards
 * to poll on a timer — keeps the long/short split (Stock & Commodity + Crypto)
 * live without re-running the heavy matrix + top-positions queries that the
 * page's main server load includes.
 *
 * Fed by `leader_cache.positions_json`, which the worker refreshes every 60 s
 * via `leader-cache-poll` (REST clearinghouseState for the top-250 tracked
 * wallets) and sub-second via `ws-live-subscriber` for the hot subset. So the
 * client poll cadence is just "how often do we want to see those underlying
 * updates" — 20 s gives a clearly-live feel without hammering the server.
 */
export const GET: RequestHandler = async () => {
  const categoryBreakdown = await getCategoryPositionBreakdown();
  return json({ ok: true, categoryBreakdown });
};
