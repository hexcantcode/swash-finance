import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { scores, wallets } from '@copytrade/db';
import { db } from '$lib/server/db';
import { listLeaders } from '$lib/server/queries/leaders';
import { listRecentTrades } from '$lib/server/queries/recent-trades';
import { listTopByWeeklyRoi } from '$lib/server/queries/weekly-leaders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const [{ leaders: topLeaders }, weeklyRoi, statsRow, recentTrades] = await Promise.all([
    listLeaders({
      filters: {},
      sort: 'composite_score',
      page: 1,
      limit: 10,
    }),
    listTopByWeeklyRoi(10),
    db()
      .select({
        wallets_total: sql<number>`(select count(*) from ${wallets})::int`,
        leaders_scored: sql<number>`(select count(*) from ${scores})::int`,
        active_recent: sql<number>`(select count(*) from ${wallets} where ${wallets.lastSeenAt} > now() - interval '30 days')::int`,
        avg_score: sql<number>`(select round(avg(${wallets.compositeScore}))::int from ${wallets} where ${wallets.compositeScore} is not null)`,
      })
      .from(wallets)
      .limit(1),
    listRecentTrades(40),
  ]);

  const tagBreakdown = await db()
    .select({
      tag: wallets.primaryTag,
      count: sql<number>`count(*)::int`,
    })
    .from(wallets)
    .where(and(eq(wallets.isAgent, false), isNotNull(wallets.primaryTag)))
    .groupBy(wallets.primaryTag)
    .orderBy(desc(sql`count(*)`));

  return {
    topLeaders,
    weeklyRoi,
    stats: statsRow[0] ?? { wallets_total: 0, leaders_scored: 0, active_recent: 0, avg_score: 0 },
    tagBreakdown,
    recentTrades,
  };
};
