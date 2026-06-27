/**
 * Extremely-Profitable closed trades, for the feed's Trades tab and the
 * per-asset detail view.
 *
 * Hyperdash has no global trade feed, so we fan out `getTraderCompletedTrades`
 * across the EP roster ONCE, merge into a cached `SmartTrade[]` sorted newest
 * close first, then derive both the feed list and per-coin slices from it. Each
 * row is a completed round-trip with realized PnL.
 *
 * Heavy (one request per trader) but slow-moving, so cached generously. Source:
 * Hyperdash public GraphQL. See the `.claude/skills/hyperdash-top-traders` skill.
 */

import { getEpRoster } from './roster.js';
import { hdFetch, ttlCache } from './shared.js';

/** Trades pulled per trader (most recent). */
const PER_TRADER = 3;
/** Rows returned to the feed, newest close first. */
const TOP_N = 40;
/** Concurrency for the per-trader fan-out. */
const BATCH = 10;

const TRADES_QUERY = `query GetTraderCompletedTrades($address: String!, $pageSize: Int) {
  getTraderCompletedTrades(address: $address, pageSize: $pageSize) {
    trades { endTime coin direction sz avgEntryPx avgExitPx netPnl notional }
  }
}`;

export interface SmartTrade {
  address: string;
  displayName: string | null;
  copyScore: number;
  coin: string;
  /** 'Long' | 'Short' as Hyperdash reports it. */
  direction: string;
  szBase: number;
  entryPxUsd: number;
  exitPxUsd: number;
  netPnlUsd: number;
  notionalUsd: number;
  closedAtMs: number;
}

interface RawTrade {
  endTime: number | string | null;
  coin: string;
  direction: string;
  sz: number | null;
  avgEntryPx: number | null;
  avgExitPx: number | null;
  netPnl: number | null;
  notional: number | null;
}

// Per-trader trade history moves slowly and the fan-out is expensive — cache
// the merged, newest-first list and slice both consumers from it.
const cache = ttlCache<SmartTrade[]>(180_000);

/** Fan out the roster's completed trades once, returning newest close first. */
async function getEpTradesFlat(): Promise<SmartTrade[]> {
  const fresh = cache.get();
  if (fresh) return fresh;

  const traders = await getEpRoster();
  if (traders.length === 0) return cache.last() ?? [];

  const all: SmartTrade[] = [];
  for (let i = 0; i < traders.length; i += BATCH) {
    const batch = traders.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((t) =>
        hdFetch<{ getTraderCompletedTrades?: { trades: RawTrade[] | null } }>('GetTraderCompletedTrades', TRADES_QUERY, {
          address: t.address,
          pageSize: PER_TRADER,
        })
          .then((d) => ({ t, trades: d?.getTraderCompletedTrades?.trades ?? [] }))
          .catch(() => ({ t, trades: [] as RawTrade[] })),
      ),
    );
    for (const { t, trades } of results) {
      for (const tr of trades) {
        const closedAtMs = typeof tr.endTime === 'string' ? Date.parse(tr.endTime) : Number(tr.endTime) || 0;
        all.push({
          address: t.address,
          displayName: t.displayName,
          copyScore: t.copyScore,
          coin: tr.coin,
          direction: tr.direction,
          szBase: Number(tr.sz) || 0,
          entryPxUsd: Number(tr.avgEntryPx) || 0,
          exitPxUsd: Number(tr.avgExitPx) || 0,
          netPnlUsd: Number(tr.netPnl) || 0,
          notionalUsd: Number(tr.notional) || 0,
          closedAtMs,
        });
      }
    }
  }

  if (all.length === 0) return cache.last() ?? [];
  all.sort((a, b) => b.closedAtMs - a.closedAtMs);
  return cache.set(all);
}

/** Newest closed trades for the feed's Trades tab. Shape UNCHANGED. */
export async function getEpTrades(): Promise<SmartTrade[]> {
  const flat = await getEpTradesFlat();
  return flat.slice(0, TOP_N);
}

/** Newest closed trades for a single coin, capped at `limit`. */
export async function getEpTradesForCoin(coin: string, limit: number): Promise<SmartTrade[]> {
  const flat = await getEpTradesFlat();
  return flat.filter((t) => t.coin === coin).slice(0, limit);
}
