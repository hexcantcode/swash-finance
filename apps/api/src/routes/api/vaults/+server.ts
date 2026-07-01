import { json } from '@sveltejs/kit';
import { getVaults } from '$lib/server/queries/vaults';
import type { RequestHandler } from './$types';

/**
 * Conviction Vaults list for the /vaults SHOWCASE page — top-12 by EP-cohort
 * volume, each with its live signal (direction, skew, breadth). Data-stage only:
 * live positioning, no invest contracts. Backed by the backtest Postgres
 * (`VAULT_PG_URL`); see docs/plans/2026-07-01-vaults-showcase-design.md.
 */
export const GET: RequestHandler = async () => {
  try {
    const vaults = await getVaults(12);
    return json({ ok: true, vaults });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message, vaults: [] }, { status: 503 });
  }
};
