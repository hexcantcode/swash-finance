import { json } from '@sveltejs/kit';
import { getEpMostHeldByCategory } from '$lib/server/ep/feed';
import type { RequestHandler } from './$types';

/**
 * Per-coin long/short holder split for the mobile feed's Sentiment tab —
 * top-N coins per category (Stock & Commodity / Crypto) by holder count,
 * each with long/short trader counts and long/short notional for the
 * dollar-weighted bar. Aggregated from the EP cohort's open positions
 * (Hyperdash, ≤ 60 s cached), so a 10–20 s client poll is plenty.
 */
export const GET: RequestHandler = async () => {
  const mostHeld = await getEpMostHeldByCategory({ perCategory: 8 });
  return json({ ok: true, mostHeld });
};
