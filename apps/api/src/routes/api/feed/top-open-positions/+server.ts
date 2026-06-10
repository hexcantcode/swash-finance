import { json } from '@sveltejs/kit';
import { getTopOpenPositionsByCategory } from '$lib/server/queries/analytics';
import type { RequestHandler } from './$types';

/**
 * Lightweight endpoint for the /analytics page's "Winning Trades" panel
 * pair (stocks left, crypto right) — top open positions ranked by
 * unrealized PnL desc per category — to poll on a timer. Returns
 * positions pre-split by category so the client doesn't re-classify.
 *
 * Same call the +page.server.ts load makes — 10 rows per category.
 *
 * Underlying data refresh cadence: ws-live-subscriber pushes (sub-second
 * for the hot subset) + REST leader-cache-poll (60 s for all 250). A
 * 20 s client poll surfaces both writers' updates without re-running
 * the JSONB unpack faster than it needs to be.
 */
export const GET: RequestHandler = async () => {
  const topOpenPositions = await getTopOpenPositionsByCategory({ perCategory: 10 });
  return json({ ok: true, topOpenPositions });
};
