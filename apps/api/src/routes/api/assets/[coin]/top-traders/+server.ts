import { json, error } from '@sveltejs/kit';
import { getAssetTopTraders } from '$lib/server/queries/asset-detail';
import type { RequestHandler } from './$types';

/** Top traders by closed PnL on this coin. Powers the mobile asset-detail
 *  "Top traders" tab; the web page gets the same data via its SSR loader. */
export const GET: RequestHandler = async ({ params, url }) => {
  if (!params.coin) throw error(400, 'missing coin');
  const raw = Number.parseInt(url.searchParams.get('limit') ?? '5', 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 25) : 5;
  const topTraders = await getAssetTopTraders(params.coin, limit);
  return json({ ok: true, topTraders });
};
