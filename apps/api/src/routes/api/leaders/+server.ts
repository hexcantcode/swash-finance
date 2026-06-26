import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { listEpLeaders } from '$lib/server/queries/ep-leaders';
import type { RequestHandler } from './$types';

const QuerySchema = z.object({
  search: z.string().optional(),
  sort: z.enum(['pnl', 'winrate']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Trader leaderboard from the Extremely Profitable Hyperdash roster. */
export const GET: RequestHandler = async ({ url }) => {
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const q = parsed.data;
  const result = await listEpLeaders({
    sort: q.sort ?? 'pnl',
    search: q.search,
    page: q.page,
    limit: q.limit,
  });
  return json({ ok: true, data: { ...result, page: q.page, limit: q.limit } });
};
