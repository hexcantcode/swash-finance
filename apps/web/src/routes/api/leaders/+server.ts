import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { listLeaders, type BrowseFilters } from '$lib/server/queries/leaders';
import type { RequestHandler } from './$types';

const QuerySchema = z.object({
  tag: z.string().optional(),
  asset: z.string().optional(),
  risk: z.string().optional(),
  heat: z.string().optional(),
  cadence: z.string().optional(),
  search: z.string().optional(),
  min: z.coerce.number().optional(),
  sort: z.enum(['composite_score', 'roi', 'last_active']).optional(),
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
    mainTag: q.tag,
    assetTag: q.asset,
    riskTag: q.risk,
    heatTag: q.heat,
    cadenceTag: q.cadence,
    minScore: q.min,
    search: q.search,
  };
  const result = await listLeaders({
    filters,
    sort: q.sort ?? 'composite_score',
    page: q.page,
    limit: q.limit,
  });
  return json({ ok: true, data: { ...result, page: q.page, limit: q.limit } });
};
