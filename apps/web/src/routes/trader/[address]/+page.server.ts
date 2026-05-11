import { error } from '@sveltejs/kit';
import { tryNormalizeAddress } from '@copytrade/shared';
import { getLeaderDetail } from '$lib/server/queries/leader-detail';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const address = tryNormalizeAddress(params.address);
  if (!address) {
    throw error(400, 'Invalid Ethereum address');
  }
  const leader = await getLeaderDetail(address);
  if (!leader) {
    throw error(404, `No data for ${address}`);
  }
  return { leader };
};
