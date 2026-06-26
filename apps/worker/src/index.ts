import { Cron } from 'croner';
import { closeDb } from './db.js';
import { withAdvisoryLock } from './db.js';
import { runCohortSnapshot } from './jobs/cohort-snapshot.js';
import { log } from './log.js';

/** Scheduled long-running worker. Run via `pnpm worker:dev` or `pnpm worker:start`. */
async function main(): Promise<void> {
  log.info('worker.starting');

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

  log.info(
    {
      cohortSnapshotNext: cohortSnapshot.nextRun()?.toISOString(),
    },
    'worker.scheduled',
  );

  const shutdown = async () => {
    log.info('worker.shutting_down');
    cohortSnapshot.stop();
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
