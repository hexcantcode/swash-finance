import { z } from 'zod';
import { listLeaders, type BrowseFilters } from '$lib/server/queries/leaders';
import { listRecentTrades } from '$lib/server/queries/recent-trades';
import { listTopByWeeklyRoi } from '$lib/server/queries/weekly-leaders';
import type { PageServerLoad } from './$types';

const ALLOWED_SORTS = ['composite_score', 'pnl', 'equity', 'frequency'] as const;
type Sort = (typeof ALLOWED_SORTS)[number];

const QuerySchema = z.object({
  tag: z.string().optional(), // → profile archetype
  heat: z.string().optional(),
  search: z.string().optional(),
  min: z.coerce.number().optional(),
  sort: z.enum(ALLOWED_SORTS).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** How many ROI-maker cards the "Winners" strip shows. */
const WINNERS_SHOWN = 10;

export const load: PageServerLoad = async ({ url }) => {
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  const params = parsed.success ? parsed.data : {};

  const filters: BrowseFilters = {
    profileTag: params.tag,
    heatTag: params.heat,
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

  // "Winners" cards: last week's biggest ROI makers among wallets that pass our
  // listing criteria (`listTopByWeeklyRoi` already returns that filtered set).
  const winners = [...weeklyRoi]
    .filter((r) => r.roi_7d != null && Number.isFinite(r.roi_7d))
    .sort((a, b) => (b.roi_7d ?? -Infinity) - (a.roi_7d ?? -Infinity))
    .slice(0, WINNERS_SHOWN)
    .map((r) => ({ address: r.address, roi_7d: r.roi_7d }));

  return {
    topLeaders: leaders.leaders,
    total: leaders.total,
    page,
    limit,
    sort,
    appliedFilters: filters,
    winners,
    recentTrades,
  };
};
