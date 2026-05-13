import { error } from '@sveltejs/kit';
import { getAssetDetail, parseRange } from '$lib/server/queries/asset-detail';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
  const range = parseRange(url.searchParams.get('range'));
  const detail = await getAssetDetail(params.coin, range);
  if (!detail) throw error(404, `Asset "${params.coin}" not found`);
  return detail;
};
