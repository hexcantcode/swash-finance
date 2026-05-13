import { describe, expect, it } from 'vitest';
import { computeScore, type ScoreInputs } from './score.js';

function inputs(overrides: Partial<ScoreInputs> = {}): ScoreInputs {
  return {
    /** 30d realized ROI as a decimal (0.30 = +30%). */
    roi30d: 0.3,
    /** profitable_weeks / weeks_with_activity over 90d, decimal 0..1. */
    weeksProfitableRatio: 9 / 13,
    /** max drawdown magnitude over 90d, decimal 0..1 (0.15 = -15%). */
    maxDrawdownPct: 0.15,
    ...overrides,
  };
}

describe('computeScore', () => {
  it('worked example from the design doc: roi=30%, weeks=9/13, dd=-15% ⇒ score=66', () => {
    const r = computeScore(inputs());
    expect(r).not.toBeNull();
    expect(r!.score).toBe(66);
    expect(r!.breakdown.profit).toBe(60);
    expect(r!.breakdown.consistency).toBe(69);
    expect(r!.breakdown.risk).toBe(70);
  });

  describe('profit band: roi / 0.50 × 100, clamped', () => {
    it('roi = 0% ⇒ profit_pts = 0', () => {
      expect(computeScore(inputs({ roi30d: 0 }))!.breakdown.profit).toBe(0);
    });
    it('roi = +25% ⇒ profit_pts = 50', () => {
      expect(computeScore(inputs({ roi30d: 0.25 }))!.breakdown.profit).toBe(50);
    });
    it('roi = +50% ⇒ profit_pts = 100 (band top)', () => {
      expect(computeScore(inputs({ roi30d: 0.5 }))!.breakdown.profit).toBe(100);
    });
    it('roi = +100% ⇒ profit_pts = 100 (clamped)', () => {
      expect(computeScore(inputs({ roi30d: 1.0 }))!.breakdown.profit).toBe(100);
    });
    it('roi = -10% ⇒ profit_pts = 0 (clamped)', () => {
      expect(computeScore(inputs({ roi30d: -0.1 }))!.breakdown.profit).toBe(0);
    });
  });

  describe('consistency band: pct × 100', () => {
    it('100% profitable weeks ⇒ consistency_pts = 100', () => {
      expect(computeScore(inputs({ weeksProfitableRatio: 1 }))!.breakdown.consistency).toBe(100);
    });
    it('0% profitable weeks ⇒ consistency_pts = 0', () => {
      expect(computeScore(inputs({ weeksProfitableRatio: 0 }))!.breakdown.consistency).toBe(0);
    });
    it('50% profitable weeks ⇒ consistency_pts = 50', () => {
      expect(computeScore(inputs({ weeksProfitableRatio: 0.5 }))!.breakdown.consistency).toBe(50);
    });
  });

  describe('risk band: (1 - dd/0.50) × 100, clamped', () => {
    it('dd = 0% ⇒ risk_pts = 100', () => {
      expect(computeScore(inputs({ maxDrawdownPct: 0 }))!.breakdown.risk).toBe(100);
    });
    it('dd = -25% ⇒ risk_pts = 50', () => {
      expect(computeScore(inputs({ maxDrawdownPct: 0.25 }))!.breakdown.risk).toBe(50);
    });
    it('dd = -50% ⇒ risk_pts = 0 (band bottom)', () => {
      expect(computeScore(inputs({ maxDrawdownPct: 0.5 }))!.breakdown.risk).toBe(0);
    });
    it('dd = -80% ⇒ risk_pts = 0 (clamped)', () => {
      expect(computeScore(inputs({ maxDrawdownPct: 0.8 }))!.breakdown.risk).toBe(0);
    });
  });

  describe('weighting and final score', () => {
    it('all three pinned at 100 ⇒ score = 100', () => {
      const r = computeScore({ roi30d: 0.5, weeksProfitableRatio: 1, maxDrawdownPct: 0 });
      expect(r!.score).toBe(100);
    });
    it('all three pinned at 0 ⇒ score = 0', () => {
      const r = computeScore({ roi30d: 0, weeksProfitableRatio: 0, maxDrawdownPct: 0.5 });
      expect(r!.score).toBe(0);
    });
    it('weights are 40/30/30: only profit at 100 ⇒ score = 40', () => {
      const r = computeScore({ roi30d: 0.5, weeksProfitableRatio: 0, maxDrawdownPct: 0.5 });
      expect(r!.score).toBe(40);
    });
    it('only consistency at 100 ⇒ score = 30', () => {
      const r = computeScore({ roi30d: 0, weeksProfitableRatio: 1, maxDrawdownPct: 0.5 });
      expect(r!.score).toBe(30);
    });
    it('only risk at 100 ⇒ score = 30', () => {
      const r = computeScore({ roi30d: 0, weeksProfitableRatio: 0, maxDrawdownPct: 0 });
      expect(r!.score).toBe(30);
    });
  });

  describe('missing data', () => {
    it('roi30d = null ⇒ null score', () => {
      expect(computeScore(inputs({ roi30d: null }))).toBeNull();
    });
    it('weeksProfitableRatio = null ⇒ null score', () => {
      expect(computeScore(inputs({ weeksProfitableRatio: null }))).toBeNull();
    });
    it('maxDrawdownPct = null ⇒ null score', () => {
      expect(computeScore(inputs({ maxDrawdownPct: null }))).toBeNull();
    });
    it('NaN inputs are treated as missing (null result)', () => {
      expect(computeScore(inputs({ roi30d: NaN }))).toBeNull();
      expect(computeScore(inputs({ weeksProfitableRatio: NaN }))).toBeNull();
      expect(computeScore(inputs({ maxDrawdownPct: NaN }))).toBeNull();
    });
  });
});
