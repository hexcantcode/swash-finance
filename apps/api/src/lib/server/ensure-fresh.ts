import {
  fills,
  leaderCache,
  preserveHip3OnMainWrite,
  type NewFill,
} from '@copytrade/db';
import { normalizeAddress } from '@copytrade/shared';
import type { ClearinghouseStateResponse } from '@copytrade/hl-client';
import { sql } from 'drizzle-orm';
import { db } from './db.js';
import { hl } from './hl.js';

const COOLDOWN_MS = 30_000;
const LEVERAGE_MAX = 9999;

// Per-address state so reload spam never multiplies HL calls.
const inFlight = new Map<string, Promise<void>>();
const lastRefreshAt = new Map<string, number>();

/**
 * On-demand HL pull for a single wallet — clearinghouseState (writes to
 * `leader_cache`) + userFills (upserts into `fills`). Used by the trader
 * page to guarantee a fresh first paint for wallets outside the backend
 * polling cohort. Bounded by:
 *   - a 30s per-address cooldown (page-reload spam → at most one HL call),
 *   - a per-address in-flight Map (N concurrent viewers → one HL call).
 *
 * Leader-cache writes share the merge contract owned by `@copytrade/db`'s
 * `preserveHip3OnMainWrite`, so this writer composes with the WS / REST /
 * HIP-3 writers without clobbering their slices.
 */
export async function ensureFresh(rawAddress: string): Promise<void> {
  const address = normalizeAddress(rawAddress);

  const last = lastRefreshAt.get(address);
  if (last !== undefined && Date.now() - last < COOLDOWN_MS) return;

  const existing = inFlight.get(address);
  if (existing) return existing;

  const promise = doRefresh(address).finally(() => {
    inFlight.delete(address);
    lastRefreshAt.set(address, Date.now());
  });
  inFlight.set(address, promise);
  return promise;
}

async function doRefresh(address: string): Promise<void> {
  const [csResult, fillsResult] = await Promise.allSettled([
    hl().clearinghouseState(address),
    hl().userFills(address),
  ]);

  if (csResult.status === 'fulfilled') {
    try {
      await upsertLeaderCache(address, csResult.value.data);
    } catch (err) {
      console.error('ensureFresh: upsertLeaderCache failed', address, err);
    }
  } else {
    console.error('ensureFresh: clearinghouseState failed', address, csResult.reason);
  }

  if (fillsResult.status === 'fulfilled' && fillsResult.value.data.length > 0) {
    try {
      await upsertFills(address, fillsResult.value.data);
    } catch (err) {
      console.error('ensureFresh: upsertFills failed', address, err);
    }
  } else if (fillsResult.status === 'rejected') {
    console.error('ensureFresh: userFills failed', address, fillsResult.reason);
  }
}

async function upsertLeaderCache(
  address: string,
  cs: ClearinghouseStateResponse,
): Promise<void> {
  const accountValueStr = cs.marginSummary.accountValue;
  const marginUsedStr = cs.marginSummary.totalMarginUsed;
  const accountValue = Number.parseFloat(accountValueStr);
  const totalNtlPos = Number.parseFloat(cs.marginSummary.totalNtlPos);
  const leverage =
    Number.isFinite(accountValue) && accountValue > 0 && Number.isFinite(totalNtlPos)
      ? clampLeverage(totalNtlPos / accountValue)
      : null;

  const now = new Date();
  await db()
    .insert(leaderCache)
    .values({
      address,
      accountValue: Number.isFinite(accountValue) ? accountValueStr : null,
      marginUsed: Number.isFinite(Number.parseFloat(marginUsedStr)) ? marginUsedStr : null,
      leverage,
      positionsJson: cs.assetPositions,
      source: 'rest_ondemand',
      lastRefreshedAt: now,
      lastRefreshSource: 'rest_ondemand',
    })
    .onConflictDoUpdate({
      target: leaderCache.address,
      set: {
        accountValue: sql`excluded.account_value`,
        marginUsed: sql`excluded.margin_used`,
        leverage: sql`excluded.leverage`,
        positionsJson: preserveHip3OnMainWrite(),
        source: sql`excluded.source`,
        lastRefreshedAt: sql`excluded.last_refreshed_at`,
        lastRefreshSource: sql`excluded.last_refresh_source`,
      },
    });
}

type UserFill = Awaited<ReturnType<ReturnType<typeof hl>['userFills']>>['data'][number];

async function upsertFills(address: string, rows: UserFill[]): Promise<void> {
  const now = new Date();
  const values: NewFill[] = rows.map((f) => ({
    tid: f.tid,
    userAddress: address,
    blockTimeMs: f.time,
    coin: f.coin,
    side: f.side,
    px: f.px,
    sz: f.sz,
    fee: f.fee,
    feeToken: f.feeToken,
    builderFee: f.builderFee ?? '0',
    oid: f.oid,
    hash: f.hash,
    crossed: f.crossed,
    closedPnl: f.closedPnl,
    startPosition: f.startPosition,
    liquidationUser: f.liquidation?.liquidatedUser ?? null,
    createdAt: now,
  }));

  // onConflictDoNothing: on-demand refresh only fills gaps; the canonical
  // worker ingest path owns full re-write semantics (incl. agent linkage).
  await db().insert(fills).values(values).onConflictDoNothing();
}

function clampLeverage(value: number): string {
  if (!Number.isFinite(value)) return '0.0000';
  const clamped = Math.max(-LEVERAGE_MAX, Math.min(LEVERAGE_MAX, value));
  return clamped.toFixed(4);
}
