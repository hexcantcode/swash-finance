import { json } from '@sveltejs/kit';
import { getHyperdashPositions } from '$lib/server/queries/hyperdash-positions';
import type { RequestHandler } from './$types';

/**
 * Smart-money open positions by market for the feed's Positions tab. Backed by
 * Hyperdash's perpsTickerPositions (cached 60 s server-side), so client polling
 * just reflects that cadence.
 */
export const GET: RequestHandler = async () => {
  const markets = await getHyperdashPositions();
  return json({ ok: true, markets });
};
