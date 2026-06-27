import { json } from '@sveltejs/kit';
import { getHyperdashTrades } from '$lib/server/queries/hyperdash-trades';
import type { RequestHandler } from './$types';

/**
 * Smart-money closed trades for the feed's Trades tab — recent completed
 * round-trips across the copytraders roster. Backed by Hyperdash (cached 180 s
 * server-side; the fan-out is expensive), so client polling reflects that.
 */
export const GET: RequestHandler = async () => {
  const trades = await getHyperdashTrades();
  return json({ ok: true, trades });
};
