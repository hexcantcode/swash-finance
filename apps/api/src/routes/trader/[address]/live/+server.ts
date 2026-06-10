import { error, json } from '@sveltejs/kit';
import { tryNormalizeAddress } from '@copytrade/shared';
import { getLiveSlice } from '$lib/server/queries/leader-detail';
import type { RequestHandler } from './$types';

// Volatile slice for the trader page client poll. Pure DB read — no HL calls
// happen here; the loader has already kicked off `ensureFresh` for stale
// addresses by the time the client starts polling.
export const GET: RequestHandler = async ({ params }) => {
  const address = tryNormalizeAddress(params.address);
  if (!address) throw error(400, 'Invalid Ethereum address');
  const live = await getLiveSlice(address);
  if (!live) throw error(404, `No data for ${address}`);
  return json(live);
};
