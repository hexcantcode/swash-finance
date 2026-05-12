import { z } from 'zod';
import { listLeaders, type BrowseFilters } from '$lib/server/queries/leaders';
import { listRecentTrades } from '$lib/server/queries/recent-trades';
import { listTopByWeeklyRoi } from '$lib/server/queries/weekly-leaders';
import type { PageServerLoad } from './$types';

const ALLOWED_SORTS = ['composite_score', 'roi', 'last_active'] as const;
type Sort = (typeof ALLOWED_SORTS)[number];

const QuerySchema = z.object({
  tag: z.string().optional(),
  asset: z.string().optional(),
  risk: z.string().optional(),
  heat: z.string().optional(),
  cadence: z.string().optional(),
  search: z.string().optional(),
  min: z.coerce.number().optional(),
  sort: z.enum(ALLOWED_SORTS).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const load: PageServerLoad = async ({ url }) => {
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  const params = parsed.success ? parsed.data : {};

  const filters: BrowseFilters = {
    mainTag: params.tag,
    assetTag: params.asset,
    riskTag: params.risk,
    heatTag: params.heat,
    cadenceTag: params.cadence,
    minScore: params.min,
    search: params.search,
  };

  const sort: Sort = params.sort ?? 'composite_score';
  const page = params.page ?? 1;
  const limit = params.limit ?? 25;

  const [leaders, weeklyRoi, recentTrades] = await Promise.all([
    listLeaders({ filters, sort, page, limit }),
    listTopByWeeklyRoi(10),
    listRecentTrades(40),
  ]);

  return {
    topLeaders: leaders.leaders,
    total: leaders.total,
    page,
    limit,
    sort,
    appliedFilters: filters,
    weeklyRoi,
    recentTrades,
  };
};
