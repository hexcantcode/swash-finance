/*
 * /api/assets client. Web's endpoint returns the full list of perp markets
 * already deduped and price-resolved; we expose two convenience views (by
 * volume, top movers) the way the legacy desktop loader did, but compute
 * them client-side off the same canonical list — no separate query.
 */

import { apiGet } from './client';

export interface Asset {
  coin: string;
  symbol: string;
  dex: string | null;
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
  openInterestUsd: number | null;
  funding: number | null;
  maxLeverage: number | null;
}

interface ListAssetsResponse {
  ok: true;
  assets: Asset[];
}

export async function listAssets(): Promise<Asset[]> {
  const body = await apiGet<ListAssetsResponse>('/api/assets');
  if (!body.ok) throw new Error('Assets request returned ok:false');
  return body.assets;
}

export interface AssetMovers {
  byVolume: Asset[];
  winners: Asset[];
  losers: Asset[];
}

export function deriveMovers(assets: Asset[]): AssetMovers {
  const byVolume = [...assets].sort(
    (a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0),
  );
  const withChange = assets.filter(
    (a) => a.change24h !== null && Number.isFinite(a.change24h),
  );
  const winners = [...withChange]
    .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    .slice(0, 5);
  const losers = [...withChange]
    .sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0))
    .slice(0, 5);
  return { byVolume, winners, losers };
}
