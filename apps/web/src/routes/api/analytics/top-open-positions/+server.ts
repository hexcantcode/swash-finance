import { json } from '@sveltejs/kit';
import { getTopOpenPositions } from '$lib/server/queries/analytics';
import type { RequestHandler } from './$types';

/**
 * Lightweight endpoint for the /analytics page's "Winning Trades" panel
 * (top open positions ranked by unrealized PnL desc) to poll on a timer.
 *
 * Same `getTopOpenPositions(20)` call the +page.server.ts load makes —
 * unpacks `leader_cache.positions_json` via JSONB and sorts. Cost is
 * proportional to total open positions across the tracked set (~1.7k
 * currently), so the query is heavier than `latest-trades` but still
 * sub-second on the existing leader_cache row count.
 *
 * Underlying data refresh cadence: ws-live-subscriber pushes (sub-second
 * for the hot subset) + REST leader-cache-poll (60 s for all 250). A
 * 20 s client poll surfaces both writers' updates without re-running
 * the JSONB unpack faster than it needs to be.
 */
export const GET: RequestHandler = async () => {
  const topOpenPositions = await getTopOpenPositions(20);
  return json({ ok: true, topOpenPositions });
};
