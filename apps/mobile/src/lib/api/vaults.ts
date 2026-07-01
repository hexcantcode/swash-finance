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
