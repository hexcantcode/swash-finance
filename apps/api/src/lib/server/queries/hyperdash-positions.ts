/**
 * Smart-money open positions by market for the feed's Positions tab.
 *
 * For each tracked market we ask Hyperdash's `perpsTickerPositions` for the
 * positions held by the highest copy-score traders (sorted `copyScore desc`),
 * keep the credible ones, and group by market. So each market shows "where the
 * smart money is positioned" rather than just the biggest whales.
 *
 * Source: Hyperdash public GraphQL (the asset page's positions table). See the
 * `.claude/skills/hyperdash-top-traders` skill for the endpoint's provenance.
 */

const HYPERDASH_GRAPHQL = 'https://api.hyperdash.com/graphql';

/** Markets to surface, by Hyperdash's ticker key (note: TradFi keys differ from
 *  the cohort feed — S&P is `SPX` here, not `XYZ:SP500`). Crypto majors + index. */
const COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'SUI', 'AVAX', 'FARTCOIN', 'SPX'];
/** Credible-trader floor — below this a position isn't "smart money". */
const MIN_COPY_SCORE = 40;
/** Positions kept per market (already the top copy-scores). */
const PER_MARKET = 5;

const QUERY = `query GetTickerPositions($coin: String!, $limit: Int, $sortBy: PerpsTickerSortInput) {
  analytics { perpsTickerPositions(coin: $coin, limit: $limit, sortBy: $sortBy) {
    coin totalLongNotional totalShortNotional longCount shortCount
    positions { address displayName copyScore verified size notionalSize entryPrice unrealizedPnl accountValue }
  } }
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
  verified: boolean;
  side: 'long' | 'short';
  szBase: number;
  notionalUsd: number;
  entryPxUsd: number;
  unrealizedPnlUsd: number;
  accountValueUsd: number;
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
  address: string;
  displayName: string | null;
  copyScore: number | null;
  verified: boolean | null;
  size: number | null;
  notionalSize: number | null;
  entryPrice: number | null;
  unrealizedPnl: number | null;
  accountValue: number | null;
}

const TTL_MS = 60_000;
let cache: { at: number; data: MarketPositions[] } | null = null;

async function fetchMarket(coin: string): Promise<MarketPositions | null> {
  try {
    const res = await fetch(HYPERDASH_GRAPHQL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        operationName: 'GetTickerPositions',
        query: QUERY,
        variables: { coin, limit: 25, sortBy: { field: 'copyScore', order: 'desc' } },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: {
        analytics?: {
          perpsTickerPositions?: {
            totalLongNotional: number | null;
            totalShortNotional: number | null;
            longCount: number | null;
            shortCount: number | null;
            positions: RawPosition[] | null;
          };
        };
      };
    };
    const t = json.data?.analytics?.perpsTickerPositions;
    if (!t) return null;

    const positions: SmartPosition[] = (t.positions ?? [])
      .filter((p) => (p.copyScore ?? 0) >= MIN_COPY_SCORE && (Number(p.size) || 0) !== 0)
      .slice(0, PER_MARKET)
      .map((p) => {
        const size = Number(p.size) || 0;
        return {
          address: p.address,
          displayName: p.displayName,
          copyScore: p.copyScore ?? 0,
          verified: p.verified ?? false,
          side: size > 0 ? 'long' : 'short',
          szBase: Math.abs(size),
          notionalUsd: Number(p.notionalSize) || 0,
          entryPxUsd: Number(p.entryPrice) || 0,
          unrealizedPnlUsd: Number(p.unrealizedPnl) || 0,
          accountValueUsd: Number(p.accountValue) || 0,
        };
      });

    if (positions.length === 0) return null;
    return {
      coin,
      longCount: t.longCount ?? 0,
      shortCount: t.shortCount ?? 0,
      longNotionalUsd: Number(t.totalLongNotional) || 0,
      shortNotionalUsd: Number(t.totalShortNotional) || 0,
      positions,
    };
  } catch {
    return null;
  }
}

export async function getHyperdashPositions(): Promise<MarketPositions[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const results = await Promise.all(COINS.map(fetchMarket));
  const data = results.filter((m): m is MarketPositions => m !== null);
  // Serve the last good snapshot on a total upstream failure.
  if (data.length === 0 && cache) return cache.data;
  cache = { at: Date.now(), data };
  return data;
}
