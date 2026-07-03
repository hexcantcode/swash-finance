/**
 * Per-market sentiment for the feed's Sentiment tab — the **Extremely Profitable**
 * cohort (+$1M+ realized PnL: the "smart money") and how it's positioned in each
 * market: long/short trader split, long/short notional, and a derived bias.
 *
 * Source: Hyperdash's public `perpsMarketParticipation` GraphQL (the Discover
 * page's Cohorts → MARKETS tab), an aggregate market-context feed across ~25k
 * traders — distinct from Swash's own per-trader numbers, which can't populate
 * cohort-wide positioning. See the `.claude/skills/hyperdash-top-traders` skill
 * for the endpoint's provenance.
 */

import { hdFetch, ttlCache } from './shared.js';

/** The one cohort whose per-market breakdown drives the notional bars — +$1M+
 *  realized PnL, the smart-money tier. */
const COHORT_ID = 'extremely_profitable';
/** Display order for the cohort table (best PnL tier first). Unknown ids sort
 *  last, preserving upstream order among themselves. */
const COHORT_ORDER = [
  'extremely_profitable',
  'very_profitable',
  'profitable',
  'unprofitable',
  'very_unprofitable',
  'rekt',
];
/** Markets shown, ranked by total directional notional (most skin first).
 *  Split client-side into Stocks & Commodities / Crypto, so keep enough to
 *  populate both. */
const TOP_N = 28;
/** Drop near-empty markets — a 1–2 trader book is noise, not a signal. */
const MIN_TRADERS = 3;

const QUERY = `query GetPerpsMarketParticipation {
  analytics { perpsMarketParticipation {
    timestamp
    pnlCohorts {
      cohortId cohortLabel cohortRange
      markets {
        coin longTraderCount shortTraderCount
        profitableTraderCount losingTraderCount
        totalLongNotional totalShortNotional
      }
    }
  } }
}`;

export type CohortBias =
  | 'very_bullish'
  | 'bullish'
  | 'slightly_bullish'
  | 'neutral'
  | 'slightly_bearish'
  | 'bearish'
  | 'very_bearish';

export interface MarketSentiment {
  /** HL coin string (may carry a dex prefix, e.g. `XYZ:SP500`). */
  coin: string;
  longTraders: number;
  shortTraders: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  /** (long − short) / (long + short) by notional, in −1..1. Drives the bias. */
  net: number;
  bias: CohortBias;
}

export interface CohortMarketSentiment {
  /** "Extremely Profitable". */
  label: string;
  /** PnL band, e.g. "+$1M+ PNL". */
  range: string;
  /** General sentiment — net long/short across *all* the cohort's markets. */
  net: number;
  bias: CohortBias;
  markets: MarketSentiment[];
}

/** One realized-PnL tier's overall directional bias — the cohort table at the
 *  top of the Sentiment tab. Net is aggregated across the tier's markets by
 *  notional, so it reads the same source as the per-market bars. */
export interface CohortSummary {
  id: string;
  label: string;
  range: string;
  net: number;
  bias: CohortBias;
}

export interface CohortFeed {
  /** All PnL tiers, best first — drives the cohort table. */
  cohorts: CohortSummary[];
  /** Per-market breakdown for the smart-money tier — drives the notional bars. */
  sentiment: CohortMarketSentiment | null;
}

interface RawMarket {
  coin: string;
  longTraderCount: number | null;
  shortTraderCount: number | null;
  profitableTraderCount: number | null;
  losingTraderCount: number | null;
  totalLongNotional: number | null;
  totalShortNotional: number | null;
}
interface RawCohort {
  cohortId: string;
  cohortLabel: string | null;
  cohortRange: string | null;
  markets: RawMarket[] | null;
}

// Hyperdash recomputes participation slowly; cache to avoid hitting it on every
// client poll (the Sentiment tab refreshes on a short timer).
const cache = ttlCache<CohortFeed>(60_000);

const EMPTY: CohortFeed = { cohorts: [], sentiment: null };

export async function getCohortSentiment(): Promise<CohortFeed> {
  const fresh = cache.get();
  if (fresh) return fresh;

  let rawCohorts: RawCohort[];
  try {
    const data = await hdFetch<{
      analytics?: { perpsMarketParticipation?: { pnlCohorts?: RawCohort[] } };
    }>('GetPerpsMarketParticipation', QUERY);
    rawCohorts = data?.analytics?.perpsMarketParticipation?.pnlCohorts ?? [];
  } catch {
    // Serve the last good snapshot if the upstream blips; else empty (the UI
    // hides the sections).
    return cache.last() ?? EMPTY;
  }

  // Cohort table — each PnL tier's overall bias, net long/short across all its
  // markets by notional (same source the per-market bars read).
  const summaries: CohortSummary[] = rawCohorts
    .map((c) => {
      let long = 0;
      let short = 0;
      for (const m of c.markets ?? []) {
        long += Number(m.totalLongNotional) || 0;
        short += Number(m.totalShortNotional) || 0;
      }
      const net = long + short > 0 ? (long - short) / (long + short) : 0;
      return {
        id: c.cohortId,
        label: c.cohortLabel ?? c.cohortId,
        range: c.cohortRange ?? '',
        net,
        bias: biasFor(net),
      };
    })
    .sort((a, b) => orderIdx(a.id) - orderIdx(b.id));

  const cohort = rawCohorts.find((c) => c.cohortId === COHORT_ID);
  if (!cohort) {
    const data = { cohorts: summaries, sentiment: null };
    return cache.set(data);
  }

  const allMarkets: MarketSentiment[] = (cohort.markets ?? [])
    .map((m) => {
      const longTraders = m.longTraderCount ?? 0;
      const shortTraders = m.shortTraderCount ?? 0;
      const long = Number(m.totalLongNotional) || 0;
      const short = Number(m.totalShortNotional) || 0;
      const total = long + short;
      const net = total > 0 ? (long - short) / total : 0;
      return {
        coin: m.coin,
        longTraders,
        shortTraders,
        longNotionalUsd: long,
        shortNotionalUsd: short,
        net,
        bias: biasFor(net),
      };
    })
    .filter((m) => m.longTraders + m.shortTraders >= MIN_TRADERS);

  // General sentiment: net long/short across the whole cohort, by notional.
  let totalLong = 0;
  let totalShort = 0;
  for (const m of allMarkets) {
    totalLong += m.longNotionalUsd;
    totalShort += m.shortNotionalUsd;
  }
  const overallNet = totalLong + totalShort > 0 ? (totalLong - totalShort) / (totalLong + totalShort) : 0;

  const markets = allMarkets
    .slice()
    .sort((a, b) => b.longNotionalUsd + b.shortNotionalUsd - (a.longNotionalUsd + a.shortNotionalUsd))
    .slice(0, TOP_N);

  const data: CohortFeed = {
    cohorts: summaries,
    sentiment: {
      label: cohort.cohortLabel ?? 'Extremely Profitable',
      range: cohort.cohortRange ?? '',
      net: overallNet,
      bias: biasFor(overallNet),
      markets,
    },
  };
  return cache.set(data);
}

/** Position of a cohort id in the display order; unknown ids sort last. */
function orderIdx(id: string): number {
  const i = COHORT_ORDER.indexOf(id);
  return i === -1 ? COHORT_ORDER.length : i;
}

/**
 * Net long/short share → bias label. Thresholds tuned so the live Hyperdash
 * numbers reproduce its own UI (e.g. −42% → bearish, +3% → slightly bullish,
 * +35% → very bullish). Negative side is widened (−0.45) so a single extreme
 * short market still reads "bearish" rather than "very bearish".
 */
export function biasFor(net: number): CohortBias {
  if (net >= 0.3) return 'very_bullish';
  if (net >= 0.1) return 'bullish';
  if (net >= 0.02) return 'slightly_bullish';
  if (net > -0.02) return 'neutral';
  if (net > -0.1) return 'slightly_bearish';
  if (net > -0.45) return 'bearish';
  return 'very_bearish';
}
