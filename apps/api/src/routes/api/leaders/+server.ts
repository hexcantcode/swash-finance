import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { listLeaders, type BrowseFilters } from '$lib/server/queries/leaders';
import type { RequestHandler } from './$types';

const QuerySchema = z.object({
  tag: z.string().optional(), // → profile archetype
  heat: z.string().optional(),
  search: z.string().optional(),
  min: z.coerce.number().optional(),
  sort: z.enum(['score', 'pnl', 'equity', 'frequency']).optional(),
  // Asset-class focus filter — see `LeaderCard.asset_focus`. Absent = no
  // restriction; `equity` / `crypto` restrict to wallets whose 30D
  // realized PnL is dominated (≥60%) by that class.
  focus: z.enum(['equity', 'crypto']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET: RequestHandler = async ({ url }) => {
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const q = parsed.data;
  const filters: BrowseFilters = {
    profileTag: q.tag,
    heatTag: q.heat,
    minScore: q.min,
    search: q.search,
    focus: q.focus,
  };
  const result = await listLeaders({
    filters,
    sort: q.sort ?? 'score',
    page: q.page,
    limit: q.limit,
  });
  return json({ ok: true, data: { ...result, page: q.page, limit: q.limit } });
};
