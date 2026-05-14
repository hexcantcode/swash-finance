import { getLatestTrades, type LatestTrade } from './analytics';

/**
 * The `TradeTicker` consumes the same order-aggregated rows as the
 * `/analytics` Latest-trades panel — they're literally the same query.
 * The only difference is scope: the ticker covers every ingested wallet
 * (`scope: 'all'`) so it stays a fast pulse of HL-wide activity, while
 * the analytics panel restricts to the curated ~250 in `leader_cache`.
 *
 * `TickerTrade` is just an alias for `LatestTrade` — keeps the import
 * names stable for the few existing consumers without re-exporting a
 * parallel shape that could drift.
 */
export type TickerTrade = LatestTrade;

export async function listRecentTrades(limit = 40): Promise<TickerTrade[]> {
  return getLatestTrades({ limit, scope: 'all' });
}
