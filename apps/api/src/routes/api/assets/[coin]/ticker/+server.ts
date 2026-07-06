import { json, error } from '@sveltejs/kit';
import { getAssetTicker } from '$lib/server/queries/asset-detail';
import type { RequestHandler } from './$types';

/** Live BBO for the trade ticket — Lighter order-book top, on demand. */
export const GET: RequestHandler = async ({ params }) => {
  if (!params.coin) throw error(400, 'missing coin');
  const ticker = await getAssetTicker(params.coin);
  if (!ticker) throw error(404, 'not tradeable on the execution venue');
  return json({ ok: true, ...ticker });
};
