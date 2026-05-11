export type MetricKey =
  | 'sharpe' | 'sortino' | 'psr'
  | 'profitFactor' | 'expectancy' | 'maxDrawdownPct'
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

// PROVISIONAL — calibrate against real HL wallet histories (a later phase).
// These are eyeballed starting points. `sharpe`/`sortino` are in DAILY-Sharpe
// units AFTER the track-record multiplier (so ~0.05 weak, ~0.15 good, ~0.30 elite).
// `maxDrawdownPct` and `recoveryTimeDays` are INVERTED (smaller raw => higher score).
export const METRIC_CURVES: Record<MetricKey, Knot[]> = {
  sharpe:             [[-0.05, 0], [0, 20], [0.05, 45], [0.10, 65], [0.20, 85], [0.35, 95], [0.6, 100]],
  sortino:            [[-0.05, 0], [0, 20], [0.07, 45], [0.14, 65], [0.28, 85], [0.5, 95], [0.9, 100]],
  psr:                [[0, 0], [0.5, 30], [0.75, 55], [0.9, 75], [0.97, 90], [0.99, 100]],
  profitFactor:       [[0.8, 0], [1, 25], [1.25, 50], [1.5, 70], [2, 85], [3, 95], [5, 100]],
  expectancy:         [[0, 30], [1, 55], [10, 75], [100, 90], [1000, 100]], // USD/trade; recalibrate per size cohort
  maxDrawdownPct:     [[0, 100], [0.1, 88], [0.2, 70], [0.3, 50], [0.5, 25], [0.8, 5], [1, 0]],
  recoveryTimeDays:   [[0, 100], [3, 90], [7, 75], [14, 55], [30, 30], [90, 5], [365, 0]],
  monthlyConsistency: [[0, 0], [0.5, 30], [0.7, 55], [0.85, 78], [0.95, 92], [1, 100]],
};

/** Map a raw metric value to 0..100. null / NaN / Infinity => null (drops out of the basket). */
export function scoreMetric(key: MetricKey, raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  return applyCurve(METRIC_CURVES[key], raw);
}
