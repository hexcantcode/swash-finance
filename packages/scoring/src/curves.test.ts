import { describe, it, expect } from 'vitest';
import { applyCurve, METRIC_CURVES, scoreMetric } from './curves.js';

describe('applyCurve', () => {
  const knots: Array<[number, number]> = [[0, 0], [1, 50], [2, 80], [3, 92]];
  it('hits the knots exactly', () => {
    expect(applyCurve(knots, 0)).toBe(0);
    expect(applyCurve(knots, 1)).toBe(50);
    expect(applyCurve(knots, 2)).toBe(80);
    expect(applyCurve(knots, 3)).toBe(92);
  });
  it('interpolates linearly between knots', () => {
    expect(applyCurve(knots, 1.5)).toBeCloseTo(65, 6);
    expect(applyCurve(knots, 2.5)).toBeCloseTo(86, 6);
  });
  it('clamps below the first knot and above the last', () => {
    expect(applyCurve(knots, -5)).toBe(0);
    expect(applyCurve(knots, 99)).toBe(92);
  });
  it('empty knots => 0', () => { expect(applyCurve([], 5)).toBe(0); });
});

describe('scoreMetric', () => {
  it('returns null for null / NaN / Infinity', () => {
    expect(scoreMetric('sharpe', null)).toBeNull();
    expect(scoreMetric('sharpe', NaN)).toBeNull();
    expect(scoreMetric('sharpe', Infinity)).toBeNull();
  });
  it('every basket metric has a curve and maps a mid value into (0,100)', () => {
    const keys = ['sharpe','sortino','psr','profitFactor','maxDrawdownPct','recoveryTimeDays','monthlyConsistency'] as const;
    for (const k of keys) {
      expect(METRIC_CURVES[k]).toBeDefined();
      expect(METRIC_CURVES[k].length).toBeGreaterThanOrEqual(2);
    }
  });
  it('inverts max-drawdown: smaller dd => higher score', () => {
    expect(scoreMetric('maxDrawdownPct', 0.05)!).toBeGreaterThan(scoreMetric('maxDrawdownPct', 0.4)!);
  });
  it('inverts recovery-time: faster recovery => higher score', () => {
    expect(scoreMetric('recoveryTimeDays', 3)!).toBeGreaterThan(scoreMetric('recoveryTimeDays', 90)!);
  });
  it('monotonic non-decreasing for a "more is better" metric (profitFactor)', () => {
    const xs = [0.5, 1, 1.25, 1.5, 2, 3, 5, 10];
    const ys = xs.map((x) => scoreMetric('profitFactor', x)!);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]!);
  });
  it('every curve has strictly increasing inputs (sorted knots)', () => {
    for (const knots of Object.values(METRIC_CURVES)) {
      for (let i = 1; i < knots.length; i++) expect(knots[i]![0]).toBeGreaterThan(knots[i - 1]![0]);
    }
  });
});
