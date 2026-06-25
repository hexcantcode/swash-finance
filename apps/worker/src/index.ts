import { Cron } from 'croner';
import { closeDb } from './db.js';
import { withAdvisoryLock } from './db.js';
import { runCohortSnapshot } from './jobs/cohort-snapshot.js';
import { runFillsRetention } from './jobs/fills-retention.js';
import { runHyperdashIngest } from './jobs/hyperdash-ingest.js';
import { runLeaderboardPoll } from './jobs/leaderboard-poll.js';
import { runRefreshQueue } from './jobs/refresh-queue.js';
import { runScoreRecompute } from './jobs/score.js';
import { log } from './log.js';

// Note: `ws-live-subscriber` runs as its own long-running process (`pnpm --filter
// @copytrade/worker ws-live`), not one of the scheduled crons below.

/** Scheduled long-running worker. Run via `pnpm worker:dev` or `pnpm worker:start`. */
async function main(): Promise<void> {
  log.info('worker.starting');

  const refresh = new Cron('*/30 * * * * *', { name: 'refresh-queue', protect: true }, async () => {
    const result = await withAdvisoryLock('worker.refresh_queue', () => runRefreshQueue());
    if (result === null) log.debug('refresh-queue.locked_skip');
  });

  const score = new Cron('0 0 2 * * *', { name: 'score', protect: true }, async () => {
    const result = await withAdvisoryLock('worker.score', () => runScoreRecompute());
    if (result === null) log.warn('score.locked_skip');
  });

  const leaderboardPoll = new Cron(
    '0 */15 * * * *',
    { name: 'leaderboard-poll', protect: true },
    async () => {
      const result = await withAdvisoryLock('worker.leaderboard_poll', () =>
        runLeaderboardPoll(),
      );
      if (result === null) log.debug('leaderboard-poll.locked_skip');
    },
  );

  // Refresh the Hyperdash curated roster hourly (at :05). Seeds new
  // copytraders into the wallets table + discovery_queue; the normal
  // fills→score pipeline takes over from there.
  const hyperdash = new Cron(
    '0 5 * * * *',
    { name: 'hyperdash', protect: true },
    async () => {
      const result = await withAdvisoryLock('worker.hyperdash', () => runHyperdashIngest());
      if (result === null) log.debug('hyperdash.locked_skip');
    },
  );

  // Snapshot Hyperdash cohort sentiment every 5 min (at :30s, ~29s after their
  // top-of-5min recompute) into cohort_sentiment_history for the over-time
  // charts. Idempotent on Hyperdash's snapshot timestamp; self-prunes.
  const cohortSnapshot = new Cron(
    '30 */5 * * * *',
    { name: 'cohort-snapshot', protect: true },
    async () => {
      const result = await withAdvisoryLock('worker.cohort_snapshot', () => runCohortSnapshot());
      if (result === null) log.debug('cohort-snapshot.locked_skip');
    },
  );

  // Nightly fills retention — runs 30 min after `score` so the day's
  // scoring sees the fuller table before trim. Skips wallets where
  // history_deepened_at IS NOT NULL.
  const fillsRetention = new Cron(
    '0 30 2 * * *',
    { name: 'fills-retention', protect: true },
    async () => {
      const result = await withAdvisoryLock('worker.fills_retention', () =>
        runFillsRetention(),
      );
      if (result === null) log.warn('fills-retention.locked_skip');
    },
  );

  log.info(
    {
      refreshNext: refresh.nextRun()?.toISOString(),
      scoreNext: score.nextRun()?.toISOString(),
      leaderboardPollNext: leaderboardPoll.nextRun()?.toISOString(),
      hyperdashNext: hyperdash.nextRun()?.toISOString(),
      cohortSnapshotNext: cohortSnapshot.nextRun()?.toISOString(),
      fillsRetentionNext: fillsRetention.nextRun()?.toISOString(),
    },
    'worker.scheduled',
  );

  const shutdown = async () => {
    log.info('worker.shutting_down');
    refresh.stop();
    score.stop();
    leaderboardPoll.stop();
    hyperdash.stop();
    cohortSnapshot.stop();
    fillsRetention.stop();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err: unknown) => {
  log.error({ err: err instanceof Error ? err.stack : err }, 'worker.fatal');
  await closeDb();
  process.exit(1);
});
