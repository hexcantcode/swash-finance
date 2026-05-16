import { sql } from 'drizzle-orm';
import { db } from '../db.js';
import { log } from '../log.js';

/**
 * `fills-retention` — nightly job that bounds the `fills` table's growth.
 *
 * Keeps `fills` at most ~90 days deep for "shallow" wallets (those with
 * `wallets.history_deepened_at IS NULL`). Wallets a user has manually
 * deepened via the "Show all history" button are exempt — their full
 * captured history persists until that flag is cleared.
 *
 * Cadence: nightly at 02:30 UTC (after the daily `score` cron at 02:00
 * UTC so the day's scores see the fuller table). See:
 *   - docs/plans/2026-05-16-fills-retention-and-deepen.md
 *   - packages/db/sql/2026-05-16-leaders-view-and-history.sql
 */

const RETENTION_DAYS = (() => {
  const raw = process.env['FILLS_RETENTION_DAYS'];
  const n = raw ? Number.parseInt(raw, 10) : 90;
  return Number.isFinite(n) && n >= 7 ? n : 90;
})();

const errMsg = (err: unknown): string =>
  err instanceof Error ? (err.stack ?? err.message) : String(err);

export async function runFillsRetention(): Promise<{
  deleted: number;
  cutoffMs: number;
  retentionDays: number;
}> {
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  log.info({ retentionDays: RETENTION_DAYS, cutoffMs }, 'fills-retention.start');

  try {
    // Delete fills older than the cutoff for wallets that haven't been
    // deepened. Joining via NOT EXISTS / IN against wallets keeps Postgres
    // honest about which set we're protecting; an unindexed scan over
    // wallets is cheap (~6.7k rows today).
    const res = await db().execute<{ deleted: number }>(sql`
      WITH deleted AS (
        DELETE FROM fills f
        USING wallets w
        WHERE f.user_address = w.address
          AND w.history_deepened_at IS NULL
          AND f.block_time_ms < ${cutoffMs}
        RETURNING 1
      )
      SELECT count(*)::int AS deleted FROM deleted
    `);
    const deleted = Number(res.rows[0]?.deleted ?? 0);
    log.info(
      { deleted, retentionDays: RETENTION_DAYS, cutoffMs },
      'fills-retention.deleted',
    );

    // ANALYZE (not VACUUM FULL — that locks the table for minutes; rely on
    // autovacuum to reclaim space over the day). Cheap enough to run inline.
    await db().execute(sql`ANALYZE fills`);

    return { deleted, cutoffMs, retentionDays: RETENTION_DAYS };
  } catch (err) {
    log.error({ err: errMsg(err) }, 'fills-retention.failed');
    throw err;
  }
}
