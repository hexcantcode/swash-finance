import { json } from '@sveltejs/kit';
import { getLatestTrades } from '$lib/server/queries/analytics';
import type { RequestHandler } from './$types';

/**
 * Lightweight endpoint for the /analytics page's Latest-trades panel to
 * poll on a timer. Same `getLatestTrades({ scope: 'tracked' })` call the
 * `+page.server.ts` load makes — kept tight (limit 20) so each poll round
 * costs roughly one fills-table scan and a 20-row JSON payload.
 *
 * The underlying `fills` table grows on every ws-live-subscriber push for
 * the hot wallet subset, plus the broader history ingest path. A 10 s
 * client poll surfaces new trades with at most ~10 s of lag — enough to
 * feel live without re-running the query faster than it needs to be.
 */
export const GET: RequestHandler = async () => {
  const latestFills = await getLatestTrades({ limit: 20 });
  return json({ ok: true, latestFills });
};
