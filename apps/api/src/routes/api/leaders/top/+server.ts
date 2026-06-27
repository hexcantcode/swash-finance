import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { listEpTopTraders } from '$lib/server/queries/ep-leaders';
import type { RequestHandler } from './$types';

const QuerySchema = z.object({
  // The EP roster is all-time only, so `window` is no longer a real filter —
  // it's accepted + echoed for the UI's tab state, but every window returns
  // the same all-time top-PnL slice. See `listEpTopTraders`.
  window: z.enum(['1d', '7d', '30d']).default('7d'),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

/** Top traders from the EP roster by all-time PnL. Drives the mobile
 *  home-screen Top Traders strip. */
export const GET: RequestHandler = async ({ url }) => {
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const { window, limit } = parsed.data;
  const traders = await listEpTopTraders(limit);
  return json({ ok: true, data: { traders, window } });
};
