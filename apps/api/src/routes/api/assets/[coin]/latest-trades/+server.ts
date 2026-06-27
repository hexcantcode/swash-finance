import { json, error } from '@sveltejs/kit';
import { getLatestOpensOnAsset } from '$lib/server/queries/asset-detail';
import type { RequestHandler } from './$types';

/** Most-recent position-open events on this coin from tracked traders. Powers
 *  the mobile asset-detail "Latest trades" tab. */
export const GET: RequestHandler = async ({ params, url }) => {
  if (!params.coin) throw error(400, 'missing coin');
  const raw = Number.parseInt(url.searchParams.get('limit') ?? '10', 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 50) : 10;
  const latestOpens = await getLatestOpensOnAsset(params.coin, limit);
  return json({ ok: true, latestOpens });
};
