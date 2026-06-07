import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { leaderCache } from '@copytrade/db';
import { tryNormalizeAddress } from '@copytrade/shared';
import { db } from '$lib/server/db';
import { ensureFresh } from '$lib/server/ensure-fresh';
import { getLeaderDetail, getLiveSlice } from '$lib/server/queries/leader-detail';
import type { PageServerLoad } from './$types';

const STALE_MS = 30_000;

export const load: PageServerLoad = async ({ params }) => {
  const address = tryNormalizeAddress(params.address);
  if (!address) {
    throw error(400, 'Invalid Ethereum address');
  }

  // Decide whether to kick off an HL pull alongside the DB read. Cohort
  // wallets (refreshed every 60s by leader-cache-poll) skip the HL call;
  // stale / non-cohort wallets get a synchronous refresh so the first paint
  // is current. ensureFresh is bounded by its own 30s cooldown + in-flight
  // dedupe, so a reload spam never multiplies upstream calls.
  const cacheRow = await db().query.leaderCache.findFirst({
    where: eq(leaderCache.address, address),
    columns: { lastRefreshedAt: true },
  });
  const stale =
    !cacheRow?.lastRefreshedAt ||
    Date.now() - cacheRow.lastRefreshedAt.getTime() > STALE_MS;

  const refreshPromise = stale ? ensureFresh(address) : Promise.resolve();
  const [leader] = await Promise.all([getLeaderDetail(address), refreshPromise]);
  if (!leader) {
    throw error(404, `No data for ${address}`);
  }

  if (stale) {
    const live = await getLiveSlice(address);
    if (live) {
      return {
        leader: {
          ...leader,
          open_positions: live.open_positions,
          recent_fills: live.recent_fills,
          live_refreshed_at: live.live_refreshed_at,
          live_source: live.live_source,
          positions_refreshed_at: live.live_refreshed_at,
        },
      };
    }
  }

  return { leader };
};
