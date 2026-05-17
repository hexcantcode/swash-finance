import { and, eq, or, sql } from 'drizzle-orm';
import { wallets } from '@copytrade/db';
import { MIN_ACCOUNT_VALUE_USD } from '@copytrade/scoring';
import { db } from '../db.js';
import { log } from '../log.js';

/**
 * Live-equity hysteresis stamp. When the live-tier writers
 * (`leader-cache-poll`, `ws-live-subscriber`) see this wallet's equity drop
 * below the listing floor, they stamp `wallets.last_below_floor_at`. The
 * `tracked_wallets` view then excludes the wallet via its CASE-based
 * hysteresis predicate (75k re-entry floor for any wallet stamped within
 * the last 7 days). No more writes to `curated` / `score` / `winner` —
 * the view is the single source of truth.
 *
 * Idempotent: only updates the stamp when it would meaningfully change
 * (>60s ago or never set), so a wallet that stays below floor doesn't
 * churn `updated_at` on every poll cycle. A repeat dip refreshes the
 * stamp, extending hysteresis another 7 days.
 *
 * Returns `true` when this call actually stamped, for log accounting.
 *
 * See docs/plans/2026-05-17-tracked-wallets-view-design.md.
 */
export async function stampIfBelowFloor(
  address: string,
  liveAccountValue: number | null,
): Promise<boolean> {
  if (liveAccountValue !== null && liveAccountValue >= MIN_ACCOUNT_VALUE_USD) return false;

  const res = await db()
    .update(wallets)
    .set({ lastBelowFloorAt: new Date() })
    .where(
      and(
        eq(wallets.address, address),
        or(
          sql`${wallets.lastBelowFloorAt} is null`,
          sql`${wallets.lastBelowFloorAt} < now() - interval '60 seconds'`,
        ),
      ),
    );

  const changed = (res.rowCount ?? 0) > 0;
  if (changed) {
    log.info(
      { address, liveAccountValue, floor: MIN_ACCOUNT_VALUE_USD },
      'gate-reconcile.stamped',
    );
  }
  return changed;
}
