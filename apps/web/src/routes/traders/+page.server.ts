import { z } from 'zod';
import { listLeaders, type BrowseFilters } from '$lib/server/queries/leaders';
import { listRecentTrades } from '$lib/server/queries/recent-trades';
import { listTopEarners7d } from '$lib/server/queries/weekly-leaders';
import { listTopWinRate } from '$lib/server/queries/win-rate-leaders';
import type { PageServerLoad } from './$types';

const ALLOWED_SORTS = ['score', 'pnl', 'equity', 'frequency'] as const;
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

/** How many cards the "Top Earners (7d)" strip shows. */
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

  const sort: Sort = params.sort ?? 'score';
  const page = params.page ?? 1;
  const limit = params.limit ?? 25;

  const [leaders, topEarners, topWinRate, recentTrades] = await Promise.all([
    listLeaders({ filters, sort, page, limit }),
    listTopEarners7d(10),
    listTopWinRate(5),
    listRecentTrades(40),
  ]);

  // "Top Earners (7d)" cards: biggest realized 7d PnL among wallets that pass
  // the listing noise filter. Already ranked 1..N by `winner_rank` (= 7d PnL
  // desc) inside `listTopEarners7d`, so we just take the first N and surface
  // both PnL and ROI to the card.
  const winners = topEarners
    .filter((r) => r.pnl_7d_usd != null && Number.isFinite(r.pnl_7d_usd))
    .slice(0, WINNERS_SHOWN)
    .map((r) => ({
      address: r.address,
      pnl_7d_usd: r.pnl_7d_usd,
      roi_7d: r.roi_7d,
    }));

  return {
    topLeaders: leaders.leaders,
    total: leaders.total,
    page,
    limit,
    sort,
    appliedFilters: filters,
    winners,
    topWinRate,
    recentTrades,
  };
};
