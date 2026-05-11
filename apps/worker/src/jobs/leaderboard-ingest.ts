import { and, eq, inArray, sql } from 'drizzle-orm';
import { discoveryQueue, wallets } from '@copytrade/db';
import {
  fetchLeaderboard,
  isEligible,
  topByWindowPnl,
  type LeaderboardRow,
} from '@copytrade/hl-client';
import { db } from '../db.js';
import { log } from '../log.js';

/**
 * Ingest from Hyperliquid's official leaderboard.
 *
 *   GET https://stats-data.hyperliquid.xyz/Mainnet/leaderboard
 *
 * Two-tier pipeline:
 *
 *   1. **Persist tier** — every wallet that passes eligibility filters lands
 *      in our `wallets` table as `ingest_state='observed'` with HL's
 *      pre-computed PnL/ROI/volume snapshot. Cheap — one row per wallet, no
 *      fill history. Default cap: 5,000 (configurable with `topPersist`).
 *
 *   2. **Queue tier** — only the top `topQueue` rows by chosen window get
 *      pushed into `discovery_queue` for J-5 fill ingest. This keeps the
 *      expensive HL API hammering bounded while still letting the
 *      leaderboard UI surface broad coverage from tier-1 data alone.
 *
 * Idempotent. Run hourly to catch new high-PnL wallets, or once on bootstrap.
 */

export interface LeaderboardIngestOptions {
  /** How many eligible rows to persist as tier-1 (no fill ingest). */
  topPersist?: number;
  /** How many top-PnL rows to queue for tier-2 (deep ingest). */
  topQueue?: number;
  minAccountValueUsd?: number;
  minMonthlyVolumeUsd?: number;
  /** Window used for the `topQueue` ranking. */
  window?: 'day' | 'week' | 'month' | 'allTime';
}

export async function runLeaderboardIngest(
  opts: LeaderboardIngestOptions = {},
): Promise<void> {
  const topPersist = opts.topPersist ?? 5_000;
  const topQueue = opts.topQueue ?? 1_000;
  const minAccountValueUsd = opts.minAccountValueUsd ?? 1_000;
  const minMonthlyVolumeUsd = opts.minMonthlyVolumeUsd ?? 10_000;
  const window = opts.window ?? 'month';

  const startedAt = Date.now();
  log.info(
    { topPersist, topQueue, minAccountValueUsd, minMonthlyVolumeUsd, window },
    'leaderboard.start',
  );

  const rawRows = await fetchLeaderboard();
  log.info({ totalRows: rawRows.length }, 'leaderboard.fetched');

  const eligible = rawRows.filter((r) =>
    isEligible(r, { minAccountValueUsd, minMonthlyVolumeUsd }),
  );

  // Sort by 30d PnL once so persist + queue are both descending on the same key.
  const rankedAll = topByWindowPnl(eligible, window, eligible.length);
  const toPersist = rankedAll.slice(0, topPersist);
  const toQueue = rankedAll.slice(0, topQueue);

  log.info(
    {
      eligible: eligible.length,
      dropped: rawRows.length - eligible.length,
      toPersist: toPersist.length,
      toQueue: toQueue.length,
      topPnl: rankedAll[0]?.month.pnl,
      cutoffPnl: rankedAll[topQueue - 1]?.month.pnl,
    },
    'leaderboard.filtered',
  );

  if (toPersist.length === 0) {
    log.warn('leaderboard.no_candidates');
    return;
  }

  const { walletsUpserted, queuedNew } = await persistAndQueueLeaderboardRows({
    toPersist,
    toQueue,
    source: 'hl_leaderboard',
  });

  log.info(
    {
      walletsUpserted,
      queuedNew,
      ms: Date.now() - startedAt,
    },
    'leaderboard.done',
  );
}

/**
 * Shared tier-1 persist + tier-2 queue mechanics for leaderboard-derived rows.
 *
 * - Upserts every `toPersist` row into `wallets` with the HL metric snapshot.
 *   On conflict we never downgrade `ingest_state`, and `total_volume_usd` only
 *   moves forward (greatest).
 * - Pushes `toQueue` addresses into `discovery_queue`; for any newly-queued
 *   address still at `ingest_state='observed'`, flip to 'queued'.
 *
 * Used by both `runLeaderboardIngest` (single-window) and `runLeaderboardPoll`
 * (dual-window union: top-7d-ROI ∪ top-rankers).
 */
export async function persistAndQueueLeaderboardRows(args: {
  toPersist: LeaderboardRow[];
  toQueue: LeaderboardRow[];
  source: string;
}): Promise<{ walletsUpserted: number; queuedNew: number }> {
  const now = new Date();
  const CHUNK = 500;
  let walletsUpserted = 0;
  let queuedNew = 0;

  for (let i = 0; i < args.toPersist.length; i += CHUNK) {
    const chunk = args.toPersist.slice(i, i + CHUNK);

    // Tier-1 persist — every eligible wallet gets a row with HL metrics.
    // `ingest_state` defaults to 'observed' on insert; on conflict we leave it
    // alone so we never downgrade scored/ingested wallets back to observed.
    // first_seen_at/last_seen_at: don't regress on conflict (least/greatest).
    await db()
      .insert(wallets)
      .values(
        chunk.map((r) => ({
          address: r.address,
          firstSeenAt: now,
          lastSeenAt: now,
          accountValue: r.accountValue.toFixed(8),
          totalVolumeUsd: r.month.vlm.toFixed(8),
          hlPnl7dUsd: r.week.pnl.toFixed(8),
          hlRoi7d: r.week.roi.toFixed(8),
          hlVolume7dUsd: r.week.vlm.toFixed(8),
          hlPnl30dUsd: r.month.pnl.toFixed(8),
          hlRoi30d: r.month.roi.toFixed(8),
          hlMetricsAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: wallets.address,
        set: {
          firstSeenAt: sql`least(${wallets.firstSeenAt}, excluded.first_seen_at)`,
          lastSeenAt: sql`greatest(${wallets.lastSeenAt}, excluded.last_seen_at)`,
          accountValue: sql`excluded.account_value`,
          totalVolumeUsd: sql`greatest(${wallets.totalVolumeUsd}, excluded.total_volume_usd)`,
          hlPnl7dUsd: sql`excluded.hl_pnl_7d_usd`,
          hlRoi7d: sql`excluded.hl_roi_7d`,
          hlVolume7dUsd: sql`excluded.hl_volume_7d_usd`,
          hlPnl30dUsd: sql`excluded.hl_pnl_30d_usd`,
          hlRoi30d: sql`excluded.hl_roi_30d`,
          hlMetricsAt: sql`excluded.hl_metrics_at`,
          updatedAt: now,
        },
      });
    walletsUpserted += chunk.length;
  }

  // Tier-2 queue — only the top N go to discovery_queue, only flip
  // ingest_state to 'queued' for wallets still at 'observed' (never downgrade).
  for (let i = 0; i < args.toQueue.length; i += CHUNK) {
    const chunk = args.toQueue.slice(i, i + CHUNK);
    const queueResult = await db()
      .insert(discoveryQueue)
      .values(chunk.map((r) => ({ address: r.address, source: args.source })))
      .onConflictDoNothing({ target: discoveryQueue.address })
      .returning({ address: discoveryQueue.address });
    queuedNew += queueResult.length;

    if (queueResult.length > 0) {
      const addresses = queueResult.map((q) => q.address);
      await db()
        .update(wallets)
        .set({ ingestState: 'queued' })
        .where(and(inArray(wallets.address, addresses), eq(wallets.ingestState, 'observed')));
    }
  }

  return { walletsUpserted, queuedNew };
}
