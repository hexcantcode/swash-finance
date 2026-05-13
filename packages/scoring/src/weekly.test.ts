import { describe, expect, it } from 'vitest';
import { weeklyProfitableRatio } from './weekly.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 4, 13, 12, 0, 0); // 2026-05-13 12:00 UTC

/** Build a fill at `weeksAgo` from NOW with the given closedPnl. */
function fill(weeksAgo: number, closedPnl: number) {
  return { blockTimeMs: NOW - weeksAgo * WEEK_MS, closedPnl };
}

describe('weeklyProfitableRatio', () => {
  it('no fills ⇒ ratio null', () => {
    const r = weeklyProfitableRatio({ fills: [], nowMs: NOW });
    expect(r.ratio).toBeNull();
    expect(r.weeksWithActivity).toBe(0);
  });

  it('one profitable week of activity ⇒ ratio = 1', () => {
    const r = weeklyProfitableRatio({ fills: [fill(1, 100), fill(1, 50)], nowMs: NOW });
    expect(r.weeksWithActivity).toBe(1);
    expect(r.profitableWeeks).toBe(1);
    expect(r.ratio).toBe(1);
  });

  it('one losing week ⇒ ratio = 0', () => {
    const r = weeklyProfitableRatio({ fills: [fill(1, -200), fill(1, 50)], nowMs: NOW });
    expect(r.weeksWithActivity).toBe(1);
    expect(r.profitableWeeks).toBe(0);
    expect(r.ratio).toBe(0);
  });

  it('a flat week (sum == 0) counts as not-profitable', () => {
    const r = weeklyProfitableRatio({ fills: [fill(1, 100), fill(1, -100)], nowMs: NOW });
    expect(r.profitableWeeks).toBe(0);
    expect(r.ratio).toBe(0);
  });

  it('3 profitable of 4 active weeks ⇒ ratio = 0.75', () => {
    const r = weeklyProfitableRatio({
      fills: [
        fill(0, 100),  // this week — profitable
        fill(1, -50),  // last week — loss
        fill(2, 30),   // 2 weeks ago — profitable
        fill(3, 10),   // 3 weeks ago — profitable
      ],
      nowMs: NOW,
    });
    expect(r.weeksWithActivity).toBe(4);
    expect(r.profitableWeeks).toBe(3);
    expect(r.ratio).toBe(0.75);
  });

  it('weeks with no activity are not counted (denominator = active weeks only)', () => {
    // Activity in weeks 0, 2, 4 — gap weeks 1 and 3 don't count.
    const r = weeklyProfitableRatio({
      fills: [fill(0, 50), fill(2, 100), fill(4, -10)],
      nowMs: NOW,
    });
    expect(r.weeksWithActivity).toBe(3);
    expect(r.profitableWeeks).toBe(2);
    expect(r.ratio).toBeCloseTo(2 / 3, 6);
  });

  it('fills outside the window are ignored', () => {
    // window default = 90 days = ~12.86 weeks; a fill from 20 weeks ago is out.
    const r = weeklyProfitableRatio({
      fills: [fill(20, 10_000), fill(1, 100)],
      nowMs: NOW,
    });
    expect(r.weeksWithActivity).toBe(1);
    expect(r.profitableWeeks).toBe(1);
    expect(r.ratio).toBe(1);
  });

  it('respects a custom windowMs', () => {
    const r = weeklyProfitableRatio({
      fills: [fill(0, 10), fill(1, 20), fill(5, 30)],
      windowMs: 3 * WEEK_MS, // 3 weeks
      nowMs: NOW,
    });
    // Only weeks 0 and 1 count.
    expect(r.weeksWithActivity).toBe(2);
    expect(r.profitableWeeks).toBe(2);
    expect(r.ratio).toBe(1);
  });

  it('fills with closedPnl == 0 still count as activity', () => {
    // An opening fill (closed_pnl=0) is still trading activity even if no PnL realized.
    const r = weeklyProfitableRatio({
      fills: [fill(1, 0), fill(1, 0)],
      nowMs: NOW,
    });
    expect(r.weeksWithActivity).toBe(1);
    expect(r.profitableWeeks).toBe(0); // sum is exactly 0, not profitable
    expect(r.ratio).toBe(0);
  });
});
