import { sql } from 'drizzle-orm';
import { fills, leaderCache, replaceDexOnHip3Write } from '@copytrade/db';
import { normalizeAddress } from '@copytrade/shared';
import { closeDb, db } from '../db.js';
import { hl } from '../hl.js';
import { log } from '../log.js';

/**
 * `hip3-poll-subscriber` — long-running REST poller for HIP-3 builder dex
 * positions. HL's main-dex WS feeds (used by `trades-coin-subscriber`) don't
 * carry HIP-3 trades, so HIP-3 holdings would otherwise go stale.
 *
 * Lifted out of `ws-live-subscriber.ts` (which is no longer run — HL's 10-
 * users-per-IP cap makes per-user WS unusable for our 250+ tracked set).
 *
 * Cadence: every 5 minutes. Walks the **HIP-3 cohort** — `leaders` view
 * members that either have a HIP-3 fill in the last 14 days, or currently
 * hold a HIP-3 position. For each (cohort_member, hip3_dex) pair, calls
 * `clearinghouseState` on that dex and merges results into
 * `leader_cache.positions_json` preserving entries from other dexes and main.
 */

const HIP3_POLL_SECONDS = 300;
const HIP3_DEX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const HIP3_COHORT_LOOKBACK_DAYS = 14;
const HIP3_PER_CALL_DELAY_MS = 100;

const errMsg = (err: unknown): string =>
  err instanceof Error ? (err.stack ?? err.message) : String(err);

export async function runHip3PollSubscriber(): Promise<void> {
  log.info({ pollSeconds: HIP3_POLL_SECONDS }, 'hip3-poll.start');

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log.info({}, 'hip3-poll.shutting_down');
    await closeDb().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const hip3DexCache: { names: string[]; fetchedAt: number } = { names: [], fetchedAt: 0 };
  const ensureHip3DexNames = async (): Promise<string[]> => {
    if (
      hip3DexCache.names.length > 0 &&
      Date.now() - hip3DexCache.fetchedAt < HIP3_DEX_CACHE_TTL_MS
    ) {
      return hip3DexCache.names;
    }
    try {
      const resp = await hl().perpDexs();
      const fresh = resp.data.flatMap((d) => (d && d.name ? [d.name] : []));
      const prev = hip3DexCache.names;
      hip3DexCache.names = fresh;
      hip3DexCache.fetchedAt = Date.now();
      const added = fresh.filter((d) => !prev.includes(d));
      const removed = prev.filter((d) => !fresh.includes(d));
      log.info({ hip3Dexes: fresh, added, removed }, 'hip3-poll.dexes_refreshed');
    } catch (err) {
      log.warn({ err: errMsg(err) }, 'hip3-poll.dexes_fetch_failed');
    }
    return hip3DexCache.names;
  };

  while (!stopping) {
    const cycleStart = Date.now();
    const hip3DexNames = await ensureHip3DexNames();
    if (hip3DexNames.length > 0) {
      try {
        await runHip3PollOnce(hip3DexNames, () => stopping);
      } catch (err) {
        log.warn({ err: errMsg(err) }, 'hip3-poll.cycle_failed');
      }
    }
    const elapsedMs = Date.now() - cycleStart;
    const intervalMs = HIP3_POLL_SECONDS * 1000;
    const sleepMs = Math.max(0, intervalMs - elapsedMs);
    if (sleepMs === 0 && elapsedMs > intervalMs) {
      log.warn({ elapsedMs, intervalMs }, 'hip3-poll.cycle_overran');
    }
    if (!stopping && sleepMs > 0) await sleep(sleepMs);
  }
}

async function runHip3PollOnce(
  hip3DexNames: string[],
  isStopping: () => boolean,
): Promise<void> {
  // Cohort = leaders ∩ (recent-HIP-3-fill ∪ current-HIP-3-holder). The
  // holder branch covers wallets that haven't traded HIP-3 in the lookback
  // window but still hold an open position — without it those positions
  // would never refresh.
  const cutoffMs = Date.now() - HIP3_COHORT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const cohortResp = await db().execute<{ address: string }>(sql`
    select l.address
    from leaders l
    where exists (
      select 1 from ${fills} f
      where f.user_address = l.address
        and f.coin like '%:%'
        and f.block_time_ms >= ${cutoffMs}
    )
    or exists (
      select 1 from ${leaderCache} lc,
           lateral jsonb_array_elements(lc.positions_json) as p(elem)
      where lc.address = l.address
        and (p.elem -> 'position' ->> 'coin') like '%:%'
    )
  `);
  const cohort = cohortResp.rows.map((r) => normalizeAddress(r.address));
  if (cohort.length === 0) {
    log.info({}, 'hip3-poll.no_cohort');
    return;
  }

  let polled = 0;
  let positionsWritten = 0;
  let failed = 0;
  for (const address of cohort) {
    for (const dexName of hip3DexNames) {
      if (isStopping()) return;
      try {
        const positionCount = await pollHip3ForAddress(address, dexName);
        positionsWritten += positionCount;
        polled += 1;
      } catch (err) {
        failed += 1;
        log.debug(
          { address, dex: dexName, err: errMsg(err) },
          'hip3-poll.call_failed',
        );
      }
      if (!isStopping()) await sleep(HIP3_PER_CALL_DELAY_MS);
    }
  }
  log.info(
    { cohort: cohort.length, dexes: hip3DexNames.length, polled, failed, positionsWritten },
    'hip3-poll.polled',
  );
}

async function pollHip3ForAddress(address: string, dexName: string): Promise<number> {
  const res = await hl().clearinghouseState(address, { dex: dexName });
  const raw = res.data.assetPositions;

  // Normalize bare symbols to `dex:SYMBOL` so storage is always prefixed.
  const normalized = raw.map((ap) => ({
    ...ap,
    position: {
      ...ap.position,
      coin: ap.position.coin.includes(':') ? ap.position.coin : `${dexName}:${ap.position.coin}`,
    },
  }));

  await db()
    .insert(leaderCache)
    .values({
      address,
      positionsJson: normalized,
      lastRefreshedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: leaderCache.address,
      set: {
        // Drop existing entries for this dex, append the fresh array; other
        // dexes / main-dex survive — same merge contract as ws-live owned.
        positionsJson: replaceDexOnHip3Write(dexName),
      },
    });

  return normalized.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
