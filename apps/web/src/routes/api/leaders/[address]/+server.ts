import { error, json } from '@sveltejs/kit';
import { tryNormalizeAddress } from '@copytrade/shared';
import { getLeaderDetail } from '$lib/server/queries/leader-detail';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const address = tryNormalizeAddress(params.address);
  if (!address) throw error(400, 'Invalid Ethereum address');
  const leader = await getLeaderDetail(address);
  if (!leader) throw error(404, 'Not found');
  return json({ ok: true, data: leader });
};
