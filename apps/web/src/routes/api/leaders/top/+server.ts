import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { listTopTradersByWindow } from '$lib/server/queries/weekly-leaders';
import type { RequestHandler } from './$types';

const QuerySchema = z.object({
  window: z.enum(['1d', '7d', '30d']).default('7d'),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

/** Top tracked traders by HL-reported realized PnL over a rolling window.
 *  Drives the mobile home-screen Top Traders strip (1d / 7d / 1m). */
export const GET: RequestHandler = async ({ url }) => {
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const { window, limit } = parsed.data;
  const traders = await listTopTradersByWindow(window, limit);
  return json({ ok: true, data: { traders, window } });
};
