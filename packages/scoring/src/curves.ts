export type MetricKey =
  | 'sharpe' | 'sortino' | 'psr'
  | 'profitFactor' | 'maxDrawdownPct'
  | 'recoveryTimeDays' | 'monthlyConsistency';

type Knot = [input: number, score: number];

/** Piecewise-linear, clamped at both ends. Knots must be sorted by input asc. */
export function applyCurve(knots: Knot[], x: number): number {
  if (knots.length === 0) return 0;
  if (x <= knots[0]![0]) return knots[0]![1];
  const last = knots[knots.length - 1]!;
  if (x >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1]!;
    const [x1, y1] = knots[i]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

// CALIBRATED 2026-05-11 from N=235 HL wallets (apps/worker calibrate-curves.ts).
// See docs/plans/2026-05-11-curve-calibration-notes.md.
// `sharpe`/`sortino` are in DAILY-Sharpe units AFTER the track-record multiplier
// — so the curve INPUTS are the *scaled* values (`sharpeScaled`/`sortinoScaled`
// in the calibration table): sample p50 ≈ 0.0065 / 0.012, p90 ≈ 0.08 / 5.8.
// `maxDrawdownPct` and `recoveryTimeDays` are INVERTED (smaller raw => higher
// score). Heavy-tailed metrics (`sortino`, `profitFactor`) are clamped near
// their sample p90 — past the top knot everything scores 100. Each curve is
// shaped so the sample-median wallet lands ~57 on that metric and ~p95+ → 90+.
export const METRIC_CURVES: Record<MetricKey, Knot[]> = {
  // Input = sharpeScaled. p10 -0.111, p25 -0.046, p50 0.0065, p75 0.035, p90 0.080, p99 0.192, max 0.30.
  // A losing record scores low but not zero (floor ~12 deep-negative, ~22 at p10); 0 → ~40; p50 → 57.
  sharpe:             [[-2, 12], [-0.11, 22], [-0.046, 32], [0, 40], [0.0065, 57], [0.018, 64], [0.035, 70], [0.055, 76], [0.08, 83], [0.19, 94], [0.3, 100]],
  // Input = sortinoScaled. Heavy-tailed: p10 -0.107, p25 -0.046, p50 0.012, p75 0.35, p90 5.8, p99 81.6.
  // Same low-end shape as sharpe; clamp ~p90 (5.8) into the high-80s, p99 ~94, then 100.
  sortino:            [[-1, 12], [-0.106, 22], [-0.046, 32], [0, 40], [0.012, 57], [0.05, 63], [0.35, 69], [1.5, 76], [5.7, 84], [20, 94], [81, 100]],
  // p10 0.0004, p25 0.058, p50 0.68, p75 0.97, p90 0.9998, p99 1.0. Discriminates low/mid then saturates.
  psr:                [[0, 12], [0.0004, 20], [0.057, 37], [0.3, 47], [0.68, 57], [0.85, 64], [0.97, 73], [0.9998, 88], [1, 100]],
  // input = per-trade pnl (sum profits / |sum losses|). p10 0.005, p25 0.27, p50 0.98, p75 2.7, p90 37.6,
  // p99 1976, max 3589. Clamp the fat tail: ~p90 (37.6) → 90, past p99 → 100. < 1 (net loser) → < 57.
  profitFactor:       [[0, 14], [0.005, 22], [0.27, 37], [0.6, 47], [0.98, 57], [1.5, 64], [2.72, 70], [8, 80], [37.6, 90], [120, 96], [1976, 100]],
  // INVERTED. raw maxDD: p10 0.004, p25 0.022, p50 0.22, p75 0.99, p90 0.999, max 1.0. Floor ~22 (a blown
  // account is bad, not negative-infinity bad — ~25% of the sample sits above 0.99); a near-zero DD → ~93.
  maxDrawdownPct:     [[0, 100], [0.004, 93], [0.022, 84], [0.05, 76], [0.1, 69], [0.22, 57], [0.4, 46], [0.7, 36], [0.99, 26], [1, 22]],
  // INVERTED. raw days: p10 2, p25 3, p50 8, p75 14, p90 22.6, max 63 (only ~half of wallets have a value).
  // 1-day recovery → ~93; sample median (8d) → 57; > a month → high-20s/low-20s.
  recoveryTimeDays:   [[1, 93], [2, 86], [3, 79], [5, 69], [8, 57], [14, 46], [22.6, 36], [40, 26], [63, 20]],
  // p25 0, p50 0.33, p75 0.75, p90 1.0. ~25% of the sample is at exactly 0 — floor ~26, not 0; p50 → 57.
  monthlyConsistency: [[0, 26], [0.1, 36], [0.2, 44], [0.3333, 57], [0.5, 65], [0.75, 75], [0.9, 87], [1, 100]],
};

/** Map a raw metric value to 0..100. null / NaN / Infinity => null (drops out of the basket). */
export function scoreMetric(key: MetricKey, raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  return applyCurve(METRIC_CURVES[key], raw);
}
