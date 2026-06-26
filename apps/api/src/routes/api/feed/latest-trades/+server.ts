import { json } from '@sveltejs/kit';
import { getEpLatestTradesByCategory } from '$lib/server/ep/feed';
import type { RequestHandler } from './$types';

/**
 * Lightweight endpoint for the feed's Latest-trades panel pair (stocks
 * left, crypto right) to poll on a timer. Returns trades pre-split by
 * category so the client doesn't have to re-classify — 10 rows per
 * category.
 *
 * Sourced from the EP cohort's recent completed trades (Hyperdash,
 * cached). A 10 s client poll surfaces new trades with low lag — enough to
 * feel live without re-running the query faster than it needs to be.
 */
export const GET: RequestHandler = async () => {
  const latestFills = await getEpLatestTradesByCategory({ perCategory: 10 });
  return json({ ok: true, latestFills });
};
