import { describe, expect, it } from 'vitest';
import { computeComposite, computeDecayFlag, type CompositeInputs } from './composite.js';

const baseInputs: CompositeInputs = {
  psr: null,
  dsr: null,
  totalTrades: 0,
  maxDrawdownPct: null,
  profitFactor: null,
  makerTakerRatio: null,
  avgHoldSeconds: null,
  uniqueAssets: 0,
  rolling30dSharpe: null,
  peakRollingSharpe: null,
};

describe('computeComposite', () => {
  it('all-null inputs ⇒ score 0', () => {
    const r = computeComposite(baseInputs);
    expect(r.score).toBe(0);
    expect(r.components.every((c) => !c.passed)).toBe(true);
  });

  it('best-case inputs ⇒ score 100', () => {
    const r = computeComposite({
      psr: 0.99,
      dsr: 0.5,
      totalTrades: 200,
      maxDrawdownPct: 0.15,
      profitFactor: 2.0,
      makerTakerRatio: 0.5,
      avgHoldSeconds: 600,
      uniqueAssets: 5,
      rolling30dSharpe: 1.5,
      peakRollingSharpe: 1.5,
    });
    expect(r.score).toBe(100);
  });

  it('partial credit accumulates correctly', () => {
    // Pass: dsr_positive (15), drawdown_under_30 (10), diversified (10) = 35
    const r = computeComposite({
      ...baseInputs,
      dsr: 0.1,
      maxDrawdownPct: 0.25,
      uniqueAssets: 4,
    });
    expect(r.score).toBe(35);
  });

  it('PSR criterion requires both high PSR AND ≥100 trades', () => {
    const lowSample = computeComposite({ ...baseInputs, psr: 0.99, totalTrades: 50 });
    expect(lowSample.score).toBe(0);
    const enoughSample = computeComposite({ ...baseInputs, psr: 0.99, totalTrades: 100 });
    expect(enoughSample.score).toBe(25);
  });

  it('maker_taker criterion requires the value to be in [0.2, 0.7]', () => {
    expect(computeComposite({ ...baseInputs, makerTakerRatio: 0.1 }).score).toBe(0);
    expect(computeComposite({ ...baseInputs, makerTakerRatio: 0.5 }).score).toBe(10);
    expect(computeComposite({ ...baseInputs, makerTakerRatio: 0.9 }).score).toBe(0);
  });
});

describe('computeDecayFlag', () => {
  it('returns null when peak is unknown or non-positive', () => {
    expect(computeDecayFlag(0.5, null)).toBeNull();
    expect(computeDecayFlag(0.5, 0)).toBeNull();
  });

  it('red when recent Sharpe is negative', () => {
    expect(computeDecayFlag(-0.3, 1.0)).toBe('red');
  });

  it('green when recent ≥ 80% of peak', () => {
    expect(computeDecayFlag(0.85, 1.0)).toBe('green');
  });

  it('yellow when recent in [50%, 80%) of peak', () => {
    expect(computeDecayFlag(0.6, 1.0)).toBe('yellow');
  });

  it('red when recent < 50% of peak', () => {
    expect(computeDecayFlag(0.3, 1.0)).toBe('red');
  });
});
