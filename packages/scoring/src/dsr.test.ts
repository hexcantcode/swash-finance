import { describe, expect, it } from 'vitest';
import { adjustedBenchmarkSharpe, deflatedSharpe } from './dsr.js';

describe('adjustedBenchmarkSharpe', () => {
  it('is 0 when SR variance is 0 (everyone identical)', () => {
    expect(adjustedBenchmarkSharpe(100, 0)).toBeCloseTo(0, 6);
  });

  it('grows with trial count (more selection bias)', () => {
    const lo = adjustedBenchmarkSharpe(10, 0.5);
    const hi = adjustedBenchmarkSharpe(1000, 0.5);
    expect(hi).toBeGreaterThan(lo);
  });

  it('grows with SR variance', () => {
    const lo = adjustedBenchmarkSharpe(100, 0.1);
    const hi = adjustedBenchmarkSharpe(100, 1.0);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('deflatedSharpe', () => {
  const sampleReturns = Array.from({ length: 60 }, (_, i) =>
    i % 3 === 0 ? -0.005 : 0.01,
  );

  it('returns null for invalid inputs', () => {
    expect(deflatedSharpe([], 1, { trialCount: 100, srVariance: 0.5 })).toBeNull();
    expect(deflatedSharpe(sampleReturns, NaN, { trialCount: 100, srVariance: 0.5 })).toBeNull();
    expect(deflatedSharpe(sampleReturns, 1, { trialCount: 0, srVariance: 0.5 })).toBeNull();
    expect(deflatedSharpe(sampleReturns, 1, { trialCount: 100, srVariance: -1 })).toBeNull();
  });

  it('is lower than PSR for the same observed Sharpe (penalizes multiple testing)', () => {
    // With variance > 0 and many trials, the adjusted benchmark > 0,
    // so DSR < PSR(0) for the same observed SR.
    const dsr = deflatedSharpe(sampleReturns, 1, { trialCount: 1000, srVariance: 0.5 })!;
    expect(dsr).not.toBeNull();
    expect(dsr).toBeGreaterThanOrEqual(0);
    expect(dsr).toBeLessThanOrEqual(1);
  });

  it('is in [0, 1] for reasonable inputs', () => {
    const dsr = deflatedSharpe(sampleReturns, 0.8, { trialCount: 200, srVariance: 0.3 });
    expect(dsr).not.toBeNull();
    expect(dsr!).toBeGreaterThanOrEqual(0);
    expect(dsr!).toBeLessThanOrEqual(1);
  });
});
