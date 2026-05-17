import { and, eq, or, sql } from 'drizzle-orm';
import { scores, wallets } from '@copytrade/db';
import { MIN_ACCOUNT_VALUE_USD } from '@copytrade/scoring';
import { db } from '../db.js';
import { log } from '../log.js';

/**
 * Live-equity gate enforcement (fast path). The daily `score` cron is the
 * canonical gate evaluator; this helper closes the up-to-24h gap by letting
 * the live-tier writers (`leader-cache-poll`, `ws-live-subscriber`) downgrade
 * a wallet within seconds when its current equity drops below the listing
 * floor.
 *
 * One-way only — re-promotion still flows through the next scoring run so
 * the curated/score state reflects fresh ROI / drawdown / consistency
 * inputs, not just an equity bump. See
 * docs/plans/2026-05-13-score-v2-design.md for the gate definition.
 *
 * Returns `true` when this call actually changed something so the caller
 * can count downgrades for log lines / metrics.
 */
export async function downgradeIfBelowFloor(
  address: string,
  liveAccountValue: number | null,
): Promise<boolean> {
  if (liveAccountValue !== null && liveAccountValue >= MIN_ACCOUNT_VALUE_USD) return false;

  const walletRes = await db()
    .update(wallets)
    .set({ curated: false, score: null, curatedSince: null, winner: false, winnerRank: null })
    .where(
      and(
        eq(wallets.address, address),
        or(
          eq(wallets.curated, true),
          eq(wallets.winner, true),
          sql`${wallets.score} is not null`,
        ),
      ),
    );
  await db()
    .update(scores)
    .set({ score: null })
    .where(and(eq(scores.address, address), sql`${scores.score} is not null`));

  const changed = (walletRes.rowCount ?? 0) > 0;
  if (changed) {
    log.info(
      { address, liveAccountValue, floor: MIN_ACCOUNT_VALUE_USD },
      'gate-reconcile.downgraded',
    );
  }
  return changed;
}
