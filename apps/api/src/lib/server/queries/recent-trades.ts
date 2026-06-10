import { getLatestTrades, type LatestTrade } from './analytics';

/**
 * The `TradeTicker` consumes the same `getLatestTrades` pipeline as the
 * `/analytics` Latest-trades panel — same shape, same order-aggregation
 * primitive, just with different options:
 *
 *   - `scope: 'all'` — covers every ingested wallet rolled to the master,
 *     not just the curated ~250 in `leader_cache`. The ticker should be a
 *     broad pulse of HL-wide activity.
 *   - `aggregation: 'session'` — collapses same-`(master, coin, side)`
 *     trades inside a 5-minute window down to one ticker row. Without
 *     this, a single scalper firing 26 single-fill orders on ZEC in two
 *     minutes ends up taking ~65% of the ticker (`api/_debug-ticker`
 *     before the fix), making the strip read like one trader's
 *     activity log. With session bucketing the same burst is one row
 *     summed across the window, and other traders' activity surfaces.
 *
 * `TickerTrade` aliases `LatestTrade` so the two surfaces never drift.
 */
export type TickerTrade = LatestTrade;

export async function listRecentTrades(limit = 40): Promise<TickerTrade[]> {
  return getLatestTrades({ limit, scope: 'all', aggregation: 'session' });
}
