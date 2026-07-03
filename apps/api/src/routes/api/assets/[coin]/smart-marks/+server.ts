import { json, error } from '@sveltejs/kit';
import { getAssetSmartMarks } from '$lib/server/queries/asset-detail';
import type { RequestHandler } from './$types';

/** EP-cohort trade markers + open-position entry levels for the asset chart. */
export const GET: RequestHandler = async ({ params }) => {
  if (!params.coin) throw error(400, 'missing coin');
  const { trades, entryLevels } = await getAssetSmartMarks(params.coin);
  return json({ ok: true, trades, entryLevels });
};
