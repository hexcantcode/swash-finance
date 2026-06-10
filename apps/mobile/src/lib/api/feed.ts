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
