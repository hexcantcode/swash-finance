/**
 * The Extremely Profitable cohort's leading traders — the shared roster behind
 * the feed's Trades and Positions tabs (and consistent with the Sentiment tab,
 * which reads the same cohort's aggregate positioning).
 *
 * Hyperdash's `exploreTraders` sorted by all-time PnL surfaces the +$1M cohort
 * (every top row reports `pnlCohort: "Extremely Profitable"`); we take the top N
 * and reuse their addresses for the per-trader fan-outs. Source: Hyperdash
 * public GraphQL. See the `.claude/skills/hyperdash-top-traders` skill.
 */

const HYPERDASH_GRAPHQL = 'https://api.hyperdash.com/graphql';

/** How many top-PnL traders to track. `exploreTraders` caps pageSize at 100. */
const ROSTER_SIZE = 80;

const QUERY = `query ExploreTraders($timeframe: TraderTimeframe!, $sortBy: TraderSortInput, $pageSize: Int) {
  exploreTraders(page: 1, pageSize: $pageSize, timeframe: $timeframe, sortBy: $sortBy) {
    data { address displayName copyScore pnl pnlCohort }
  }
}`;

const HEADERS = {
  'content-type': 'application/json',
  origin: 'https://hyperdash.com',
  referer: 'https://hyperdash.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

export interface EpTrader {
  address: string;
  displayName: string | null;
  copyScore: number;
  pnlUsd: number;
}

// The cohort membership moves slowly (it's all-time PnL); cache hard so the two
// expensive per-trader fan-outs share one roster fetch.
const TTL_MS = 600_000;
let cache: { at: number; data: EpTrader[] } | null = null;

export async function getExtremelyProfitableTraders(): Promise<EpTrader[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetch(HYPERDASH_GRAPHQL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        operationName: 'ExploreTraders',
        query: QUERY,
        variables: { timeframe: 'all', sortBy: { field: 'pnl', order: 'desc' }, pageSize: ROSTER_SIZE },
      }),
    });
    if (!res.ok) throw new Error(`hyperdash ${res.status}`);
    const json = (await res.json()) as {
      data?: { exploreTraders?: { data?: { address: string; displayName: string | null; copyScore: number; pnl: number }[] } };
    };
    const rows = json.data?.exploreTraders?.data ?? [];
    const data: EpTrader[] = rows.map((r) => ({
      address: r.address,
      displayName: r.displayName,
      copyScore: r.copyScore ?? 0,
      pnlUsd: Number(r.pnl) || 0,
    }));
    if (data.length === 0) return cache?.data ?? [];
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? [];
  }
}
