import { error, json } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { discoveryQueue, leaderCache, wallets } from '@copytrade/db';
import { tryNormalizeAddress } from '@copytrade/shared';
import { db } from '$lib/server/db';
import { hl } from '$lib/server/hl';
import type { RequestHandler } from './$types';

const REFRESH_COOLDOWN_SEC = 60;

export const POST: RequestHandler = async ({ params }) => {
  const address = tryNormalizeAddress(params.address);
  if (!address) throw error(400, 'Invalid Ethereum address');

  const wallet = await db().query.wallets.findFirst({ where: eq(wallets.address, address) });
  if (!wallet) throw error(404, 'Unknown wallet');

  const cache = await db().query.leaderCache.findFirst({
    where: eq(leaderCache.address, address),
  });
  const now = new Date();
  const ageSec = cache?.lastRefreshedAt
    ? (now.getTime() - cache.lastRefreshedAt.getTime()) / 1000
    : Infinity;

  if (cache && ageSec < REFRESH_COOLDOWN_SEC) {
    return json({
      ok: true,
      data: {
        cache_age_seconds: Math.floor(ageSec),
        next_refresh_in_seconds: Math.ceil(REFRESH_COOLDOWN_SEC - ageSec),
        positions: cache.positionsJson,
        recent_fills: cache.recentFillsJson,
        account_value: cache.accountValue,
        from_cache: true,
      },
    });
  }

  const since30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const [state, fillsResp, fundingsResp, ledgerResp] = await Promise.all([
    hl().clearinghouseState(address),
    hl().userFills(address),
    hl().userFunding(address, since30d),
    hl().userNonFundingLedgerUpdates(address, since30d),
  ]);

  const accountValue = state.data.marginSummary?.accountValue ?? null;
  const positionsJson = state.data.assetPositions ?? [];
  const recentFillsJson = fillsResp.data.slice(0, 50);

  await db()
    .insert(leaderCache)
    .values({
      address,
      lastRefreshedAt: now,
      nextRefreshAfter: new Date(now.getTime() + REFRESH_COOLDOWN_SEC * 1000),
      accountValue,
      positionsJson,
      recentFillsJson,
      funding30dJson: fundingsResp.data,
      ledger30dJson: ledgerResp.data,
      refreshCount: (cache?.refreshCount ?? 0) + 1,
      lastRefreshSource: 'user_click',
    })
    .onConflictDoUpdate({
      target: leaderCache.address,
      set: {
        lastRefreshedAt: now,
        nextRefreshAfter: new Date(now.getTime() + REFRESH_COOLDOWN_SEC * 1000),
        accountValue,
        positionsJson,
        recentFillsJson,
        funding30dJson: fundingsResp.data,
        ledger30dJson: ledgerResp.data,
        refreshCount: sql`${leaderCache.refreshCount} + 1`,
        lastRefreshSource: 'user_click',
      },
    });

  // Re-queue for full ingestion (J-5 picks it up).
  await db()
    .insert(discoveryQueue)
    .values({ address, source: 'user_refresh' })
    .onConflictDoNothing();

  return json({
    ok: true,
    data: {
      cache_age_seconds: 0,
      next_refresh_in_seconds: REFRESH_COOLDOWN_SEC,
      positions: positionsJson,
      recent_fills: recentFillsJson,
      account_value: accountValue,
      from_cache: false,
      weight_cost:
        state.weightCost + fillsResp.weightCost + fundingsResp.weightCost + ledgerResp.weightCost,
    },
  });
};
