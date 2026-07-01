import { json } from '@sveltejs/kit';
import { getVaultDetail } from '$lib/server/queries/vaults';
import type { RequestHandler } from './$types';

/**
 * One vault's detail for /vaults/[asset] — latest signal summary + skew history
 * + contributing traders. Data-stage showcase. Backed by the backtest Postgres.
 */
export const GET: RequestHandler = async ({ params }) => {
  try {
    const detail = await getVaultDetail(decodeURIComponent(params.asset));
    if (!detail) return json({ ok: false, error: 'not found' }, { status: 404 });
    return json({ ok: true, ...detail });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
};
