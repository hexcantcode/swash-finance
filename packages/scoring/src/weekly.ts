/**
 * Weekly profitable-ratio over a trailing window — the "consistency" input
 * to the Swash score. Bucket fills into 7-day buckets aligned to the most
 * recent week (window-start), sum `closed_pnl` per bucket, count buckets
 * with sum > 0, divide by buckets that contain *any* activity.
 *
 * Weeks with zero activity are not counted in the denominator — a wallet
 * that traded in 11 of the trailing 13 weeks is judged on those 11.
 *
 * Design: docs/plans/2026-05-13-score-v2-design.md, §3.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface WeeklyFill {
  blockTimeMs: number;
  closedPnl: number;
}

export interface WeeklyConsistencyInputs {
  fills: WeeklyFill[];
  /** Trailing window length in ms. Defaults to 90 days. */
  windowMs?: number;
  /** "Now" timestamp in ms. Defaults to `Date.now()`. */
  nowMs?: number;
}

export interface WeeklyConsistencyResult {
  weeksWithActivity: number;
  profitableWeeks: number;
  /** profitableWeeks / weeksWithActivity, or null when no active weeks. */
  ratio: number | null;
}

export function weeklyProfitableRatio(
  input: WeeklyConsistencyInputs,
): WeeklyConsistencyResult {
  const now = input.nowMs ?? Date.now();
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
  const windowStart = now - windowMs;

  // bucket idx 0 = the current (newest) week; idx increases going backward.
  const byBucket = new Map<number, number>();
  for (const f of input.fills) {
    if (f.blockTimeMs < windowStart || f.blockTimeMs > now) continue;
    const bucket = Math.floor((now - f.blockTimeMs) / WEEK_MS);
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + f.closedPnl);
  }

  const weeksWithActivity = byBucket.size;
  if (weeksWithActivity === 0) {
    return { weeksWithActivity: 0, profitableWeeks: 0, ratio: null };
  }
  let profitableWeeks = 0;
  for (const sum of byBucket.values()) {
    if (sum > 0) profitableWeeks += 1;
  }
  return {
    weeksWithActivity,
    profitableWeeks,
    ratio: profitableWeeks / weeksWithActivity,
  };
}
