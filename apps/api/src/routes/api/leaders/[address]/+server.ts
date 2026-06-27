import { error, json } from '@sveltejs/kit';
import { tryNormalizeAddress } from '@copytrade/shared';
import { getEpTraderDetail } from '$lib/server/ep/trader';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const address = tryNormalizeAddress(params.address);
  if (!address) throw error(400, 'Invalid Ethereum address');
  const detail = await getEpTraderDetail(address);
  if (!detail) throw error(404, 'Not found');
  return json({ ok: true, data: detail });
};
