import { json } from '@sveltejs/kit';
import { getLatestTradesByCategory } from '$lib/server/queries/analytics';
import type { RequestHandler } from './$types';

/**
 * Lightweight endpoint for the /analytics page's Latest-trades panel pair
 * (stocks left, crypto right) to poll on a timer. Returns trades pre-split
 * by category so the client doesn't have to re-classify. Same call the
 * `+page.server.ts` load makes — 10 rows per category, server over-fetches
 * to keep both buckets full even when the data is skewed.
 *
 * The underlying `fills` table grows on every ws-live-subscriber push for
 * the hot wallet subset, plus the broader history ingest path. A 10 s
 * client poll surfaces new trades with at most ~10 s of lag — enough to
 * feel live without re-running the query faster than it needs to be.
 */
export const GET: RequestHandler = async () => {
  const latestFills = await getLatestTradesByCategory({ perCategory: 10 });
  return json({ ok: true, latestFills });
};
