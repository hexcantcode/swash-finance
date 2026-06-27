/**
 * Extremely-Profitable closed trades for the feed's Trades tab.
 *
 * Hyperdash has no global trade feed, so we fan out `getTraderCompletedTrades`
 * across the Extremely Profitable roster (see hyperdash-ep-traders), merge by
 * close time, and keep the most recent. Each row is a completed round-trip with
 * realized PnL — "what the +$1M cohort just closed" (same cohort the Sentiment
 * and Positions tabs read).
 *
 * Heavy (one request per trader) but slow-moving, so cached generously. Source:
 * Hyperdash public GraphQL. See the `.claude/skills/hyperdash-top-traders` skill.
 */

import { getExtremelyProfitableTraders } from './hyperdash-ep-traders.js';

const HYPERDASH_GRAPHQL = 'https://api.hyperdash.com/graphql';

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

const HEADERS = {
  'content-type': 'application/json',
  origin: 'https://hyperdash.com',
  referer: 'https://hyperdash.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

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

// Per-trader trade history moves slowly and the fan-out is expensive — cache hard.
const TTL_MS = 180_000;
let cache: { at: number; data: SmartTrade[] } | null = null;

async function hd<T>(operationName: string, query: string, variables: unknown): Promise<T | null> {
  try {
    const res = await fetch(HYPERDASH_GRAPHQL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ operationName, query, variables }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function getHyperdashTrades(): Promise<SmartTrade[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const traders = await getExtremelyProfitableTraders();
  if (traders.length === 0) return cache?.data ?? [];

  const all: SmartTrade[] = [];
  for (let i = 0; i < traders.length; i += BATCH) {
    const batch = traders.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((t) =>
        hd<{ getTraderCompletedTrades: { trades: RawTrade[] | null } }>('GetTraderCompletedTrades', TRADES_QUERY, {
          address: t.address,
          pageSize: PER_TRADER,
        }).then((d) => ({ t, trades: d?.getTraderCompletedTrades?.trades ?? [] })),
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

  const data = all.sort((a, b) => b.closedAtMs - a.closedAtMs).slice(0, TOP_N);
  if (data.length === 0 && cache) return cache.data;
  cache = { at: Date.now(), data };
  return data;
}
