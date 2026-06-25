/**
 * Extremely-Profitable open positions by market for the feed's Positions tab.
 *
 * Fans out `traderPerpPositionsTooltip` across the Extremely Profitable roster
 * (see hyperdash-ep-traders), flattens every open position, and groups by
 * market. So each market shows "where the +$1M cohort is positioned" — the same
 * cohort the Sentiment and Trades tabs read.
 *
 * Source: Hyperdash public GraphQL. See the `.claude/skills/hyperdash-top-traders` skill.
 */

import { getExtremelyProfitableTraders } from './hyperdash-ep-traders.js';

const HYPERDASH_GRAPHQL = 'https://api.hyperdash.com/graphql';

/** Markets shown, ranked by EP-cohort notional. */
const MARKETS_SHOWN = 14;
/** Positions kept per market (biggest notional). */
const PER_MARKET = 6;
/** Skip dust — a tiny position isn't a signal. */
const MIN_NOTIONAL = 25_000;
/** Concurrency for the per-trader fan-out. */
const BATCH = 10;

const QUERY = `query TraderPerpPositionsTooltip($address: String!, $timestamp: Float!, $limit: Int) {
  traderPerpPositionsTooltip(address: $address, timestamp: $timestamp, limit: $limit) {
    positions { market size notionalSize entryPrice unrealizedPnl }
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

export interface SmartPosition {
  address: string;
  displayName: string | null;
  copyScore: number;
  side: 'long' | 'short';
  szBase: number;
  notionalUsd: number;
  entryPxUsd: number;
  unrealizedPnlUsd: number;
}

export interface MarketPositions {
  coin: string;
  longCount: number;
  shortCount: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  positions: SmartPosition[];
}

interface RawPosition {
  market: string;
  size: number | null;
  notionalSize: number | null;
  entryPrice: number | null;
  unrealizedPnl: number | null;
}

const TTL_MS = 60_000;
let cache: { at: number; data: MarketPositions[] } | null = null;

export async function getHyperdashPositions(): Promise<MarketPositions[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const traders = await getExtremelyProfitableTraders();
  if (traders.length === 0) return cache?.data ?? [];
  const nowMs = Date.now();

  // Flatten every EP trader's positions, tagged with the coin.
  const byCoin = new Map<string, SmartPosition[]>();
  for (let i = 0; i < traders.length; i += BATCH) {
    const batch = traders.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const res = await fetch(HYPERDASH_GRAPHQL, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
              operationName: 'TraderPerpPositionsTooltip',
              query: QUERY,
              variables: { address: t.address, timestamp: nowMs, limit: 50 },
            }),
          });
          if (!res.ok) return [] as { coin: string; pos: SmartPosition }[];
          const json = (await res.json()) as {
            data?: { traderPerpPositionsTooltip?: { positions: RawPosition[] | null } };
          };
          const positions = json.data?.traderPerpPositionsTooltip?.positions ?? [];
          return positions
            .filter((p) => Math.abs(Number(p.notionalSize) || 0) >= MIN_NOTIONAL && (Number(p.size) || 0) !== 0)
            .map((p) => {
              const size = Number(p.size) || 0;
              const pos: SmartPosition = {
                address: t.address,
                displayName: t.displayName,
                copyScore: t.copyScore,
                side: size > 0 ? 'long' : 'short',
                szBase: Math.abs(size),
                notionalUsd: Math.abs(Number(p.notionalSize) || 0),
                entryPxUsd: Number(p.entryPrice) || 0,
                unrealizedPnlUsd: Number(p.unrealizedPnl) || 0,
              };
              return { coin: p.market, pos };
            });
        } catch {
          return [] as { coin: string; pos: SmartPosition }[];
        }
      }),
    );
    for (const traderPositions of results) {
      for (const { coin, pos } of traderPositions) {
        const list = byCoin.get(coin) ?? [];
        list.push(pos);
        byCoin.set(coin, list);
      }
    }
  }

  const markets: MarketPositions[] = [...byCoin.entries()].map(([coin, list]) => {
    let longCount = 0;
    let shortCount = 0;
    let longNotionalUsd = 0;
    let shortNotionalUsd = 0;
    for (const p of list) {
      if (p.side === 'long') {
        longCount += 1;
        longNotionalUsd += p.notionalUsd;
      } else {
        shortCount += 1;
        shortNotionalUsd += p.notionalUsd;
      }
    }
    const positions = list.sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, PER_MARKET);
    return { coin, longCount, shortCount, longNotionalUsd, shortNotionalUsd, positions };
  });

  const data = markets
    .sort((a, b) => b.longNotionalUsd + b.shortNotionalUsd - (a.longNotionalUsd + a.shortNotionalUsd))
    .slice(0, MARKETS_SHOWN);

  if (data.length === 0 && cache) return cache.data;
  cache = { at: Date.now(), data };
  return data;
}
