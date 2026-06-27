import { json } from '@sveltejs/kit';
import { getEpTopOpenPositionsByCategory } from '$lib/server/ep/feed';
import type { RequestHandler } from './$types';

/**
 * Lightweight endpoint for the feed's "Winning Trades" panel pair (stocks
 * left, crypto right) — biggest open positions by notional per category —
 * to poll on a timer. Returns positions pre-split by category so the
 * client doesn't re-classify — 10 rows per category.
 *
 * Sourced from the EP cohort's open positions (Hyperdash, ≤ 60 s cached).
 * A 20 s client poll keeps the live view fresh.
 */
export const GET: RequestHandler = async () => {
  const topOpenPositions = await getEpTopOpenPositionsByCategory({ perCategory: 10 });
  return json({ ok: true, topOpenPositions });
};
