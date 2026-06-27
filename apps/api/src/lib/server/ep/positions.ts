/**
 * Extremely-Profitable open positions, for the feed's Positions tab and the
 * per-asset detail view.
 *
 * Fans out `traderPerpPositionsTooltip` across the EP roster ONCE, flattens
 * every open position into a cached `SmartPosition[]`, then derives both the
 * grouped-by-market feed result and a single-coin slice from that one cache.
 *
 * Source: Hyperdash public GraphQL. See the `.claude/skills/hyperdash-top-traders` skill.
 */

import { getEpRoster } from './roster.js';
import { hdFetch, ttlCache } from './shared.js';

/** Markets shown in the feed, ranked by EP-cohort notional. */
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

/** One position tagged with its coin — the flat shape we cache and re-group. */
type TaggedPosition = { coin: string; pos: SmartPosition };

// Cache the flat fan-out result; both the grouped feed and the per-coin slice
// derive from it, so we fetch the roster's positions at most once per TTL.
const cache = ttlCache<TaggedPosition[]>(60_000);

/** Fan out the roster's open positions once, returning a flat tagged list. */
async function getEpPositionsFlat(): Promise<TaggedPosition[]> {
  const fresh = cache.get();
  if (fresh) return fresh;

  const traders = await getEpRoster();
  if (traders.length === 0) return cache.last() ?? [];
  const nowMs = Date.now();

  const all: TaggedPosition[] = [];
  for (let i = 0; i < traders.length; i += BATCH) {
    const batch = traders.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const data = await hdFetch<{
            traderPerpPositionsTooltip?: { positions: RawPosition[] | null };
          }>('TraderPerpPositionsTooltip', QUERY, { address: t.address, timestamp: nowMs, limit: 50 });
          const positions = data?.traderPerpPositionsTooltip?.positions ?? [];
          return positions
            .filter((p) => Math.abs(Number(p.notionalSize) || 0) >= MIN_NOTIONAL && (Number(p.size) || 0) !== 0)
            .map((p): TaggedPosition => {
              const size = Number(p.size) || 0;
              return {
                coin: p.market,
                pos: {
                  address: t.address,
                  displayName: t.displayName,
                  copyScore: t.copyScore,
                  side: size > 0 ? 'long' : 'short',
                  szBase: Math.abs(size),
                  notionalUsd: Math.abs(Number(p.notionalSize) || 0),
                  entryPxUsd: Number(p.entryPrice) || 0,
                  unrealizedPnlUsd: Number(p.unrealizedPnl) || 0,
                },
              };
            });
        } catch {
          return [] as TaggedPosition[];
        }
      }),
    );
    for (const traderPositions of results) all.push(...traderPositions);
  }

  if (all.length === 0) return cache.last() ?? [];
  return cache.set(all);
}

/** Aggregate a coin's flat positions into a `MarketPositions` row. */
function toMarket(coin: string, list: SmartPosition[]): MarketPositions {
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
  const positions = list.slice().sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, PER_MARKET);
  return { coin, longCount, shortCount, longNotionalUsd, shortNotionalUsd, positions };
}

/** Grouped-by-market positions for the feed's Positions tab. Shape UNCHANGED. */
export async function getEpPositions(): Promise<MarketPositions[]> {
  const flat = await getEpPositionsFlat();

  const byCoin = new Map<string, SmartPosition[]>();
  for (const { coin, pos } of flat) {
    const list = byCoin.get(coin) ?? [];
    list.push(pos);
    byCoin.set(coin, list);
  }

  return [...byCoin.entries()]
    .map(([coin, list]) => toMarket(coin, list))
    .sort((a, b) => b.longNotionalUsd + b.shortNotionalUsd - (a.longNotionalUsd + a.shortNotionalUsd))
    .slice(0, MARKETS_SHOWN);
}

/** EP positions for a single coin, or null if the cohort isn't in it. */
export async function getEpPositionsForCoin(coin: string): Promise<MarketPositions | null> {
  const flat = await getEpPositionsFlat();
  const list = flat.filter((p) => p.coin === coin).map((p) => p.pos);
  if (list.length === 0) return null;
  return toMarket(coin, list);
}
