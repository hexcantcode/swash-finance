/**
 * /api/vaults client — the Conviction Vaults showcase (data-stage: live
 * positioning, no invest contracts yet). See the /vaults page.
 */

import { apiGet } from './client';

export interface VaultSummary {
  coin: string;
  traders: number;
  longs: number;
  shorts: number;
  volumeUsd: number;
  /** signed skew ∈ [-1,1]; null if no signal yet. */
  skew: number | null;
  contributors: number | null;
  direction: 'long' | 'short' | 'flat';
  updatedAtMs: number | null;
}

interface VaultsResponse {
  ok: boolean;
  vaults: VaultSummary[];
}

export async function getVaults(): Promise<VaultSummary[]> {
  const body = await apiGet<VaultsResponse>('/api/vaults');
  return body.vaults ?? [];
}

export interface VaultSkewPoint {
  ts: number;
  skew: number;
  contributors: number;
}

export interface VaultContributor {
  address: string;
  displayName: string | null;
  direction: 'long' | 'short';
  convictionPct: number;
  notionalUsd: number;
  score: number | null;
}

export interface VaultNavPoint {
  ts: number;
  vaultNav: number;
  assetNav: number;
}

export interface VaultDetail {
  summary: VaultSummary;
  skewHistory: VaultSkewPoint[];
  contributors: VaultContributor[];
  navHistory: VaultNavPoint[];
}

interface VaultDetailResponse {
  ok: boolean;
  summary: VaultSummary;
  skewHistory: VaultSkewPoint[];
  contributors: VaultContributor[];
  navHistory: VaultNavPoint[];
}

export async function getVaultDetail(coin: string): Promise<VaultDetail | null> {
  const body = await apiGet<VaultDetailResponse>(`/api/vaults/${encodeURIComponent(coin)}`);
  if (!body.ok) return null;
  return {
    summary: body.summary,
    skewHistory: body.skewHistory,
    contributors: body.contributors,
    navHistory: body.navHistory ?? [],
  };
}
