/*
 * /api/feed/* clients. The web app exposes pre-split (stocks / crypto) trade
 * streams and a top-open-positions snapshot. Mobile flattens those into a
 * single feed by default — the user can filter to a category via tabs.
 */

import { apiGet, apiUrl } from './client';

export type FeedCategory = 'stocks' | 'crypto' | 'index';

export interface LatestFill {
  key: string;
  address: string;
  coin: string;
  side: 'A' | 'B' | string;
  fillCount: number;
  szBase: number;
  notionalUsd: number;
  vwapUsd: number;
  blockTimeMs: number;
  leverage: number | null;
}

interface LatestFillsResponse {
  ok: true;
  latestFills: {
    stocks: LatestFill[];
    crypto: LatestFill[];
  };
}

export interface CategorizedFills {
  stocks: LatestFill[];
  crypto: LatestFill[];
}

export async function getLatestFills(): Promise<CategorizedFills> {
  const body = await apiGet<LatestFillsResponse>('/api/feed/latest-trades');
  if (!body.ok) throw new Error('Latest fills request returned ok:false');
  return body.latestFills;
}

/** Live trade feed via SSE (`/api/stream/trades`). Calls `onFills` with each
 *  fresh snapshot — the initial one on connect, then again whenever new fills
 *  land. EventSource auto-reconnects. Returns a close fn. Browser-only. */
export function subscribeLatestFills(onFills: (fills: CategorizedFills) => void): () => void {
  const es = new EventSource(apiUrl('/api/stream/trades'));
  es.onmessage = (ev) => {
    let body: unknown;
    try {
      body = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return;
    }
    const latestFills = (body as { latestFills?: CategorizedFills } | null)?.latestFills;
    if (latestFills) onFills(latestFills);
  };
  return () => {
    es.onmessage = null;
    try {
      es.close();
    } catch {
      /* ignore */
    }
  };
}

export interface TopOpenPosition {
  address: string;
  coin: string;
  side: 'long' | 'short';
  szBase: number;
  entryPxUsd: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  returnOnEquity: number | null;
  leverage: number | null;
  liquidationPxUsd: number | null;
  lastRefreshedAtMs: number;
  realizedPnlUsd: number | null;
}

interface TopOpenPositionsResponse {
  ok: true;
  topOpenPositions: {
    stocks: TopOpenPosition[];
    crypto: TopOpenPosition[];
    index?: TopOpenPosition[];
  };
}

export interface CategorizedPositions {
  stocks: TopOpenPosition[];
  crypto: TopOpenPosition[];
  index: TopOpenPosition[];
}

export async function getTopOpenPositions(): Promise<CategorizedPositions> {
  const body = await apiGet<TopOpenPositionsResponse>(
    '/api/feed/top-open-positions',
  );
  if (!body.ok) throw new Error('Top positions request returned ok:false');
  return {
    stocks: body.topOpenPositions.stocks ?? [],
    crypto: body.topOpenPositions.crypto ?? [],
    index: body.topOpenPositions.index ?? [],
  };
}

/** Flatten and sort all fills newest-first. The web app keeps stocks/crypto
 *  separate for the two-pane desktop layout; the mobile feed shows one
 *  scrolling list. */
export function mergeFills(fills: CategorizedFills): LatestFill[] {
  return [...fills.stocks, ...fills.crypto].sort(
    (a, b) => b.blockTimeMs - a.blockTimeMs,
  );
}

// ── Sentiment (per-coin long/short holder split) ───────────────────────────

export interface MostHeldRow {
  coin: string;
  holders: number;
  longCount: number;
  shortCount: number;
  netNotionalUsd: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
}

export interface CategorizedMostHeld {
  stocks: MostHeldRow[];
  crypto: MostHeldRow[];
}

interface MostHeldResponse {
  ok: true;
  mostHeld: {
    stocks: MostHeldRow[];
    crypto: MostHeldRow[];
  };
}

export async function getMostHeld(): Promise<CategorizedMostHeld> {
  const body = await apiGet<MostHeldResponse>('/api/feed/most-held');
  if (!body.ok) throw new Error('Most-held request returned ok:false');
  return {
    stocks: body.mostHeld.stocks ?? [],
    crypto: body.mostHeld.crypto ?? [],
  };
}

// ── Cohort market sentiment (Extremely Profitable cohort, long/short by market) ──

export type CohortBias =
  | 'very_bullish'
  | 'bullish'
  | 'slightly_bullish'
  | 'neutral'
  | 'slightly_bearish'
  | 'bearish'
  | 'very_bearish';

export interface MarketSentiment {
  coin: string;
  longTraders: number;
  shortTraders: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  net: number;
  bias: CohortBias;
}

export interface CohortMarketSentiment {
  label: string;
  range: string;
  /** General sentiment — net long/short across all the cohort's markets. */
  net: number;
  bias: CohortBias;
  markets: MarketSentiment[];
}

/** One realized-PnL tier's overall bias — the cohort table at the top of the
 *  Sentiment tab. */
export interface CohortSummary {
  id: string;
  label: string;
  range: string;
  net: number;
  bias: CohortBias;
}

export interface CohortFeed {
  cohorts: CohortSummary[];
  sentiment: CohortMarketSentiment | null;
}

interface CohortSentimentResponse {
  ok: true;
  cohorts: CohortSummary[];
  sentiment: CohortMarketSentiment | null;
}

export async function getCohortSentiment(): Promise<CohortFeed> {
  const body = await apiGet<CohortSentimentResponse>('/api/feed/cohort-sentiment');
  if (!body.ok) throw new Error('Cohort-sentiment request returned ok:false');
  return { cohorts: body.cohorts ?? [], sentiment: body.sentiment ?? null };
}
