import { describe, expect, it } from 'vitest';
import {
  annualizedSharpe,
  annualizedSortino,
  dailySharpe,
  excessKurtosis,
  expectancy,
  maxDrawdownPct,
  profitFactor,
  recoveryTimeDays,
  skewness,
  winRate,
} from './metrics.js';

describe('annualizedSharpe', () => {
  it('returns null for empty/single-element arrays', () => {
    expect(annualizedSharpe([])).toBeNull();
    expect(annualizedSharpe([0.01])).toBeNull();
  });

  it('returns null when stddev is zero (constant returns)', () => {
    expect(annualizedSharpe([0.01, 0.01, 0.01, 0.01])).toBeNull();
  });

  it('matches a hand-calculated value for symmetric returns', () => {
    // mean = 0.01; sample sd = sqrt(4*0.005²/3) ≈ 0.005774; sqrt(365) ≈ 19.105
    // SR = (0.01 / 0.005774) * 19.105 ≈ 33.09
    const sr = annualizedSharpe([0.005, 0.015, 0.005, 0.015]);
    expect(sr).not.toBeNull();
    expect(sr!).toBeCloseTo(33.09, 1);
  });

  it('is negative for loss-heavy returns', () => {
    const sr = annualizedSharpe([-0.01, -0.02, -0.005, -0.015]);
    expect(sr).not.toBeNull();
    expect(sr!).toBeLessThan(0);
  });
});

describe('annualizedSortino', () => {
  it('returns null when there are no downside returns', () => {
    expect(annualizedSortino([0.01, 0.02, 0.005])).toBeNull();
  });

  it('produces a positive value for mixed returns with mean > 0', () => {
    const so = annualizedSortino([0.02, -0.01, 0.03, -0.005, 0.01]);
    expect(so).not.toBeNull();
    expect(so!).toBeGreaterThan(0);
  });
});

describe('maxDrawdownPct', () => {
  it('is 0 for monotonically increasing returns', () => {
    expect(maxDrawdownPct([0.01, 0.01, 0.01])).toBe(0);
  });

  it('detects a 50% drawdown after a +100% gain followed by -75%', () => {
    // 1 -> 2 (peak) -> 0.5 ⇒ 75% drawdown from peak
    const dd = maxDrawdownPct([1, -0.75]);
    expect(dd).toBeCloseTo(0.75, 4);
  });

  it('returns null on empty', () => {
    expect(maxDrawdownPct([])).toBeNull();
  });

  it('only counts the worst drawdown, not the second-worst', () => {
    // peak=1.10, trough=0.99 ⇒ ~10% dd
    // then peak=1.10*1.05=1.155, trough=1.155*0.5=0.5775 ⇒ 50% dd
    const dd = maxDrawdownPct([0.1, -0.1, 0.05, -0.5]);
    expect(dd).toBeGreaterThan(0.4);
    expect(dd).toBeLessThan(0.55);
  });
});

describe('recoveryTimeDays', () => {
  it('returns null when never recovers', () => {
    expect(recoveryTimeDays([0.1, -0.5, -0.1])).toBeNull();
  });

  it('measures the longest peak-to-recovery gap', () => {
    // peak after day 0 (+10%); drops, recovers on day 4 (4 days)
    const r = recoveryTimeDays([0.1, -0.05, -0.02, 0.01, 0.07]);
    expect(r).toBe(4);
  });
});

describe('profitFactor', () => {
  it('returns null for empty', () => {
    expect(profitFactor([])).toBeNull();
  });

  it('= gross gain / gross loss', () => {
    expect(profitFactor([0.1, -0.05, 0.15, -0.05])).toBeCloseTo(0.25 / 0.1, 4);
  });

  it('returns Infinity when there are gains but no losses', () => {
    expect(profitFactor([0.1, 0.2, 0.05])).toBe(Infinity);
  });
});

describe('winRate', () => {
  it('returns null for empty', () => {
    expect(winRate([])).toBeNull();
  });

  it('returns the fraction of positive trades', () => {
    expect(winRate([1, -1, 1, 1, -1])).toBeCloseTo(0.6, 4);
  });
});

describe('expectancy', () => {
  it('returns null for empty', () => {
    expect(expectancy([])).toBeNull();
  });
  it('returns the mean per-trade PnL', () => {
    expect(expectancy([10, 20, -15, 5])).toBeCloseTo(5, 4);
  });
});

describe('skewness / excessKurtosis', () => {
  it('returns 0 for fewer than 3/4 samples respectively', () => {
    expect(skewness([1, 2])).toBe(0);
    expect(excessKurtosis([1, 2, 3])).toBe(0);
  });

  it('skewness ~0 for symmetric data', () => {
    expect(Math.abs(skewness([-2, -1, 0, 1, 2]))).toBeLessThan(0.001);
  });

  it('skewness > 0 for right-skewed data', () => {
    expect(skewness([0, 0, 0, 0, 10])).toBeGreaterThan(0);
  });

  it('excess kurtosis ~0 for normal-ish data', () => {
    // Symmetric uniform in [-1, 1]: theoretical excess kurtosis = -1.2
    const uniform = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9];
    expect(excessKurtosis(uniform)).toBeLessThan(0);
  });
});

describe('dailySharpe', () => {
  it('is annualizedSharpe / sqrt(365)', () => {
    const r = [0.01, -0.005, 0.02, 0.0, 0.008, -0.012, 0.015];
    const daily = dailySharpe(r)!;
    const ann = annualizedSharpe(r)!;
    expect(daily).toBeCloseTo(ann / Math.sqrt(365), 10);
  });
  it('returns null for <2 returns or zero variance', () => {
    expect(dailySharpe([0.01])).toBeNull();
    expect(dailySharpe([0.01, 0.01, 0.01])).toBeNull();
  });
});
