/**
 * PnL-cohort sentiment for the feed's Sentiment tab.
 *
 * Groups traders by realized-PnL band (Extremely Profitable … Rekt) and reads
 * each band's net long/short positioning as a bullish/bearish signal — the
 * "smart money vs. the crowd" read (e.g. the +$1M cohort leaning short while
 * the Rekt cohort piles long).
 *
 * Source: Hyperdash's public `CohortSummary` GraphQL (≈25k traders), an
 * aggregate market-context feed — distinct from Swash's own per-trader numbers,
 * which we can't use here (our tracked set is far too small to populate the
 * loss cohorts). See docs/plans/2026-06-22-hyperdash-trader-source.md and the
 * `.claude/skills/hyperdash-top-traders` skill for the endpoint's provenance.
 */

const HYPERDASH_GRAPHQL = 'https://api.hyperdash.com/graphql';

const QUERY = `query CohortSummary {
  analytics { cohortSummary { timestamp pnlCohorts {
    id label emoji range totalTraders longNotional shortNotional
  } } }
}`;

// A browser UA is required — the endpoint blocks default fetch/curl agents.
const HEADERS = {
  'content-type': 'application/json',
  origin: 'https://hyperdash.com',
  referer: 'https://hyperdash.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

export type CohortBias =
  | 'very_bullish'
  | 'bullish'
  | 'slightly_bullish'
  | 'neutral'
  | 'slightly_bearish'
  | 'bearish'
  | 'very_bearish';

export interface CohortSentiment {
  id: string;
  /** "Extremely Profitable" … "Rekt". */
  label: string;
  emoji: string;
  /** PnL band, e.g. "+$1M+ PNL". */
  range: string;
  totalTraders: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  /** (long − short) / (long + short), in −1..1. Drives the bias. */
  net: number;
  bias: CohortBias;
}

interface RawCohort {
  id: string;
  label: string;
  emoji: string | null;
  range: string | null;
  totalTraders: number;
  longNotional: number | null;
  shortNotional: number | null;
}

// Hyperdash recomputes cohortSummary slowly; cache to avoid hitting it on every
// client poll (the Sentiment tab refreshes on a short timer).
const TTL_MS = 60_000;
let cache: { at: number; data: CohortSentiment[] } | null = null;

export async function getCohortSentiment(): Promise<CohortSentiment[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  let raw: RawCohort[];
  try {
    const res = await fetch(HYPERDASH_GRAPHQL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ operationName: 'CohortSummary', variables: {}, query: QUERY }),
    });
    if (!res.ok) throw new Error(`hyperdash ${res.status}`);
    const json = (await res.json()) as {
      data?: { analytics?: { cohortSummary?: { pnlCohorts?: RawCohort[] } } };
    };
    raw = json.data?.analytics?.cohortSummary?.pnlCohorts ?? [];
  } catch {
    // Serve the last good snapshot if the upstream blips; else empty (the UI
    // hides the section).
    return cache?.data ?? [];
  }

  const data: CohortSentiment[] = raw.map((c) => {
    const long = Number(c.longNotional) || 0;
    const short = Number(c.shortNotional) || 0;
    const total = long + short;
    const net = total > 0 ? (long - short) / total : 0;
    return {
      id: c.id,
      label: c.label,
      emoji: c.emoji ?? '',
      range: c.range ?? '',
      totalTraders: c.totalTraders ?? 0,
      longNotionalUsd: long,
      shortNotionalUsd: short,
      net,
      bias: biasFor(net),
    };
  });

  cache = { at: Date.now(), data };
  return data;
}

/**
 * Net long/short share → bias label. Thresholds tuned so the live Hyperdash
 * numbers reproduce its own UI (e.g. −42% → bearish, +3% → slightly bullish,
 * +35% → very bullish). Negative side is widened (−0.45) so a single extreme
 * short cohort still reads "bearish" rather than "very bearish".
 */
function biasFor(net: number): CohortBias {
  if (net >= 0.3) return 'very_bullish';
  if (net >= 0.1) return 'bullish';
  if (net >= 0.02) return 'slightly_bullish';
  if (net > -0.02) return 'neutral';
  if (net > -0.1) return 'slightly_bearish';
  if (net > -0.45) return 'bearish';
  return 'very_bearish';
}
