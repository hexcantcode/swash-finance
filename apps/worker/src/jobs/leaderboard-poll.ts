import {
  fetchLeaderboard,
  isEligible,
  topByWindowPnl,
  type LeaderboardRow,
} from '@copytrade/hl-client';
import { log } from '../log.js';
import { persistAndQueueLeaderboardRows } from './leaderboard-ingest.js';

/**
 * Scheduled poll of HL's official leaderboard, biased toward *curation
 * candidates*. Unlike `runLeaderboardIngest` (which sweeps a single window
 * broadly), this picks two sharper buckets:
 *
 *   1. Top-N by **7d ROI** (`week.roi` desc) — catches recent hot streaks
 *      that the all-time-PnL ranking misses.
 *   2. Top-N by **trader-ranking PnL** (`allTime.pnl` desc) — the steady
 *      long-tenure ranks that HL's own UI surfaces.
 *
 * The two sets are unioned/deduped, persisted into `wallets` with the HL
 * snapshot (tier-1, no fill history), and queued into `discovery_queue` so
 * `refresh-queue` can deep-ingest them; the next `score` run then evaluates
 * them against the curation gate (see jobs/score.ts).
 *
 * This job never deep-ingests inline — that's `refresh-queue`'s job. Cron
 * cadence: every 15 minutes.
 */

export interface LeaderboardPollOptions {
  /** Top-N rows by `week.roi` (7d ROI) to include. */
  topRoi?: number;
  /** Top-N rows by `allTime.pnl` (trader-ranking PnL) to include. */
  topRankers?: number;
  /** Eligibility floor: minimum current account value (USD). */
  minAccountValueUsd?: number;
  /** Eligibility floor: minimum 30d volume (USD). */
  minMonthlyVolumeUsd?: number;
}

export async function runLeaderboardPoll(opts: LeaderboardPollOptions = {}): Promise<void> {
  const topRoi = opts.topRoi ?? 100;
  const topRankers = opts.topRankers ?? 100;
  const minAccountValueUsd = opts.minAccountValueUsd ?? 1_000;
  const minMonthlyVolumeUsd = opts.minMonthlyVolumeUsd ?? 10_000;

  const startedAt = Date.now();
  log.info({ topRoi, topRankers, minAccountValueUsd, minMonthlyVolumeUsd }, 'leaderboard-poll.start');

  const rawRows = await fetchLeaderboard();
  log.info({ totalRows: rawRows.length }, 'leaderboard-poll.fetched');

  const eligible = rawRows.filter((r) =>
    isEligible(r, { minAccountValueUsd, minMonthlyVolumeUsd }),
  );

  // Bucket 1: top by 7d ROI. `topByWindowPnl` sorts by *pnl*, not roi, so we
  // hand-roll the ROI sort. (Volume floor in `isEligible` already filters out
  // the $50-trade 1000x noise.)
  const topByRoi7d = [...eligible]
    .sort((a, b) => b.week.roi - a.week.roi)
    .slice(0, topRoi);

  // Bucket 2: top by all-time PnL (the "trader-rankers" the HL UI surfaces).
  const topByRanking = topByWindowPnl(eligible, 'allTime', topRankers);

  // Union/dedupe by address (lower-cased addrs come pre-normalized from hl-client).
  const byAddr = new Map<string, LeaderboardRow>();
  for (const r of topByRoi7d) byAddr.set(r.address, r);
  for (const r of topByRanking) byAddr.set(r.address, r);
  const candidates = [...byAddr.values()];

  log.info(
    {
      eligible: eligible.length,
      dropped: rawRows.length - eligible.length,
      topByRoi7d: topByRoi7d.length,
      topByRanking: topByRanking.length,
      deduped: candidates.length,
    },
    'leaderboard-poll.selected',
  );

  if (candidates.length === 0) {
    log.warn('leaderboard-poll.no_candidates');
    return;
  }

  const { walletsUpserted, queuedNew } = await persistAndQueueLeaderboardRows({
    toPersist: candidates,
    toQueue: candidates,
    source: 'hl_leaderboard_poll',
  });

  log.info(
    {
      walletsUpserted,
      queuedNew,
      ms: Date.now() - startedAt,
    },
    'leaderboard-poll.done',
  );
}
