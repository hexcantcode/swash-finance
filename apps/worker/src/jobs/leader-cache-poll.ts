import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { leaderCache, wallets } from '@copytrade/db';
import { MIN_ACCOUNT_VALUE_USD } from '@copytrade/scoring';
import { normalizeAddress } from '@copytrade/shared';
import type { ClearinghouseStateResponse } from '@copytrade/hl-client';
import { closeDb, db } from '../db.js';
import { hl } from '../hl.js';
import { preserveHip3OnMainWrite } from '../lib/leader-cache-merge.js';
import { log } from '../log.js';

/**
 * `leader-cache-poll` — long-running REST poller that keeps `leader_cache`
 * fresh for the **broader tracked set** (top `TRACKED_LIMIT` wallets by HL
 * 7d PnL passing the listing floor). Companion to `ws-live-subscriber`,
 * which holds per-user WS subscriptions on a smaller hot subset (HL caps
 * those at 10 unique users per WS connection — making WS the wrong tool
 * for a 250-wallet cohort).
 *
 * Each cycle:
 *   1. Pick top-`TRACKED_LIMIT` tracked wallets (same listing-floor query
 *      the home-page leaderboard uses, single source of truth).
 *   2. Fan out `info.clearinghouseState({ user })` calls with bounded
 *      concurrency (HL allows ~1200 weight/min; clearinghouseState is
 *      weight 2 → 250 wallets/cycle = 500 weight per cycle, 21–42% of
 *      the budget at 120s/60s cadence).
 *   3. Upsert `leader_cache` with the same columns + HIP-3-preserving
 *      `positions_json` merge that `ws-live-subscriber.handleWebData2`
 *      uses. `source = 'rest_poll'`, `last_refresh_source = 'rest_poll'`.
 *
 * Why REST and not WS for the broader cohort: the HL WS
 * `WebSocketSubscriptionManager` hard-caps each connection at 10 unique
 * users (see `_subscriptionManager.ts:86`). Sharding to ~28 connections
 * to cover 250 wallets triggers cascade subscribe timeouts under burst
 * load (HL's response queue falls behind when ~32 subscribes hit a
 * single socket back-to-back). REST has no per-IP user cap and the
 * weight budget is generous, so polling is the robust path.
 *
 * Launch via `pnpm --filter @copytrade/worker leader-cache-poll`
 * (sibling to `ws-live`).
 */

const DEFAULT_POLL_SECONDS = 60;

/** How many tracked wallets to poll each cycle. Overridable via env. */
const TRACKED_LIMIT = (() => {
  const raw = process.env['REST_POLL_TRACKED_LIMIT'];
  const n = raw ? Number.parseInt(raw, 10) : 250;
  return Number.isFinite(n) && n > 0 ? n : 250;
})();

/**
 * Max parallel in-flight `clearinghouseState` calls. 5 keeps the HL request
 * pipeline gentle while still finishing 250 calls in well under 60s
 * (typical p50 ~80ms × 250/5 = ~4s).
 */
const CONCURRENCY = 5;

export async function runLeaderCachePoll(
  opts: { pollSeconds?: number } = {},
): Promise<void> {
  const pollSeconds = opts.pollSeconds ?? DEFAULT_POLL_SECONDS;
  log.info(
    { pollSeconds, trackedLimit: TRACKED_LIMIT, concurrency: CONCURRENCY },
    'leader-cache-poll.start',
  );

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log.info('leader-cache-poll.shutting_down');
    await closeDb().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (!stopping) {
    const startedAt = Date.now();
    try {
      await pollOnce(() => stopping);
    } catch (err) {
      log.warn({ err: errMsg(err) }, 'leader-cache-poll.cycle_failed');
    }
    const elapsedMs = Date.now() - startedAt;
    const sleepMs = Math.max(0, pollSeconds * 1000 - elapsedMs);
    if (sleepMs > 0 && !stopping) await sleep(sleepMs);
  }
}

async function pollOnce(isStopping: () => boolean): Promise<void> {
  const t0 = Date.now();

  // Same listing-floor query as ws-live-subscriber + the home-page leaderboard
  // (single source of truth): `is_agent = false`, `account_value >= $25k`,
  // `hl_pnl_7d_usd IS NOT NULL`, ordered by 7d PnL desc, top TRACKED_LIMIT.
  const rows = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(
      and(
        eq(wallets.isAgent, false),
        isNotNull(wallets.hlPnl7dUsd),
        sql`${wallets.accountValue} >= ${MIN_ACCOUNT_VALUE_USD}`,
      ),
    )
    .orderBy(desc(wallets.hlPnl7dUsd))
    .limit(TRACKED_LIMIT);
  const addresses = rows.map((r) => normalizeAddress(r.address));

  let ok = 0;
  let failed = 0;
  let positionsRefreshed = 0;
  let withHip3 = 0;

  let cursor = 0;
  const workOne = async () => {
    while (!isStopping()) {
      const i = cursor++;
      if (i >= addresses.length) return;
      const addr = addresses[i]!;
      try {
        const res = await hl().clearinghouseState(addr);
        await upsertLeaderCacheFromClearinghouse(addr, res.data);
        ok += 1;
        if (res.data.assetPositions.length > 0) positionsRefreshed += 1;
        // Snapshot-only HIP-3 check — `clearinghouseState` (main dex) doesn't
        // return HIP-3 entries directly; the upsert's merge SQL keeps any
        // existing HIP-3 entries that `ws-live-subscriber`'s perpDexs poller
        // wrote previously. Bump the counter if leader_cache HAD HIP-3 entries
        // before this write … actually skip; we'd need to read-back. Drop.
      } catch (err) {
        failed += 1;
        log.warn(
          { address: addr, err: errMsg(err) },
          'leader-cache-poll.fetch_failed',
        );
      }
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(workOne());
  await Promise.all(workers);

  log.info(
    {
      tracked: addresses.length,
      ok,
      failed,
      positionsRefreshed,
      withHip3,
      ms: Date.now() - t0,
    },
    'leader-cache-poll.cycle_done',
  );
}

/**
 * Upsert `leader_cache` from a `clearinghouseState` REST response.
 *
 * Mirrors `ws-live-subscriber.handleWebData2`'s upsert (same columns, same
 * `positions_json` merge contract from `../lib/leader-cache-merge.ts`), but
 * with `source = 'rest_poll'` so downstream consumers can distinguish the
 * writer. The shared `preserveHip3OnMainWrite()` merge keeps existing HIP-3
 * entries (coin contains `:`, owned by `ws-live-subscriber`'s perpDexs
 * poller) and appends this call's main-dex array — so the three writers
 * (WS push, REST main poll, HIP-3 dex poll) compose without clobbering
 * each other's slice.
 */
async function upsertLeaderCacheFromClearinghouse(
  address: string,
  cs: ClearinghouseStateResponse,
): Promise<void> {
  const accountValueStr = cs.marginSummary.accountValue;
  const marginUsedStr = cs.marginSummary.totalMarginUsed;
  const accountValue = Number.parseFloat(accountValueStr);
  const totalNtlPos = Number.parseFloat(cs.marginSummary.totalNtlPos);
  // Account-level GROSS leverage = total notional position / account value.
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
      source: 'rest_poll',
      lastRefreshedAt: now,
      lastRefreshSource: 'rest_poll',
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

// ── helpers ────────────────────────────────────────────────────────────────

const LEVERAGE_MAX = 9999;

/** Mirror of ws-live-subscriber's clampLeverage; numeric(20,4) safe. */
function clampLeverage(value: number): string {
  if (!Number.isFinite(value)) return '0.0000';
  const clamped = Math.max(-LEVERAGE_MAX, Math.min(LEVERAGE_MAX, value));
  return clamped.toFixed(4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
