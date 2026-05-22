/*
 * /api/top-positions client — highest-value open positions across the curated
 * leaders, ranked by USD notional. Canonical query lives in apps/web's
 * queries/top-positions.ts; this mirrors only the response shape.
 */

import { apiGet } from './client';

export interface TopPosition {
  address: string;
  coin: string;
  side: 'long' | 'short';
  /** Absolute USD notional of the position. */
  notionalUsd: number;
}

interface TopPositionsResponse {
  ok: true;
  positions: TopPosition[];
}

export async function listTopPositions(limit = 25): Promise<TopPosition[]> {
  const body = await apiGet<TopPositionsResponse>(
    `/api/top-positions?limit=${limit}`,
  );
  if (!body.ok) throw new Error('Top positions request returned ok:false');
  return body.positions;
}
