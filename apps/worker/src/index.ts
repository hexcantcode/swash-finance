import { Cron } from 'croner';
import { closeDb } from './db.js';
import { withAdvisoryLock } from './db.js';
import { runRefreshQueue } from './jobs/refresh-queue.js';
import { runScoreRecompute } from './jobs/score.js';
import { log } from './log.js';

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

  log.info(
    {
      refreshNext: refresh.nextRun()?.toISOString(),
      scoreNext: score.nextRun()?.toISOString(),
    },
    'worker.scheduled',
  );

  const shutdown = async () => {
    log.info('worker.shutting_down');
    refresh.stop();
    score.stop();
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
