import { json } from '@sveltejs/kit';
import { getMostHeldByCategory } from '$lib/server/queries/analytics';
import type { RequestHandler } from './$types';

/**
 * Per-coin long/short holder split for the mobile feed's Sentiment tab —
 * top-N coins per category (Stock & Commodity / Crypto) by holder count,
 * each with long/short trader counts and long/short notional for the
 * dollar-weighted bar. Same `getMostHeldByCategory` unpack the /analytics
 * "Most Held" panel uses; fed by `leader_cache.positions_json` (≤ 60 s
 * fresh), so a 10–20 s client poll is plenty.
 */
export const GET: RequestHandler = async () => {
  const mostHeld = await getMostHeldByCategory({ perCategory: 8 });
  return json({ ok: true, mostHeld });
};
