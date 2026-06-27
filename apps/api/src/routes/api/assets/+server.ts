import { json } from '@sveltejs/kit';
import { listAssets } from '$lib/server/queries/assets';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const assets = await listAssets();
  return json({ ok: true, assets });
};
