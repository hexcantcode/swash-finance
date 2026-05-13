import { json, error } from '@sveltejs/kit';
import { getAssetCandles, parseRange } from '$lib/server/queries/asset-detail';
import type { RequestHandler } from './$types';

/** Re-poll endpoint used by the chart's range-tab switcher and the 12s tick. */
export const GET: RequestHandler = async ({ params, url }) => {
  const range = parseRange(url.searchParams.get('range'));
  if (!params.coin) throw error(400, 'missing coin');
  const candles = await getAssetCandles(params.coin, range);
  return json({ ok: true, range, candles });
};
