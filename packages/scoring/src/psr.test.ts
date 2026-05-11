import { describe, expect, it } from 'vitest';
import { probabilisticSharpe, standardNormalCdf, standardNormalInverseCdf } from './psr.js';

describe('standardNormalCdf', () => {
  it('Φ(0) = 0.5', () => {
    expect(standardNormalCdf(0)).toBeCloseTo(0.5, 6);
  });
  it('Φ(1.96) ≈ 0.975', () => {
    expect(standardNormalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it('Φ(-1.96) ≈ 0.025', () => {
    expect(standardNormalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it('Φ(3) ≈ 0.9987', () => {
    expect(standardNormalCdf(3)).toBeCloseTo(0.9987, 3);
  });
});

describe('standardNormalInverseCdf', () => {
  it('Φ⁻¹(0.5) = 0', () => {
    expect(standardNormalInverseCdf(0.5)).toBeCloseTo(0, 5);
  });
  it('Φ⁻¹(0.975) ≈ 1.96', () => {
    expect(standardNormalInverseCdf(0.975)).toBeCloseTo(1.96, 2);
  });
  it('round-trips through CDF', () => {
    for (const p of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      const z = standardNormalInverseCdf(p);
      expect(standardNormalCdf(z)).toBeCloseTo(p, 4);
    }
  });
});

describe('probabilisticSharpe', () => {
  it('returns null for fewer than 2 observations', () => {
    expect(probabilisticSharpe([], 1)).toBeNull();
    expect(probabilisticSharpe([0.01], 1)).toBeNull();
  });

  it('PSR(0) = 0.5 when observed Sharpe equals benchmark, regardless of distribution', () => {
    const sym = [0.01, -0.01, 0.02, -0.02, 0.005, -0.005];
    expect(probabilisticSharpe(sym, 0, 0)!).toBeCloseTo(0.5, 4);
  });

  it('PSR is monotonically increasing in observed Sharpe (positive)', () => {
    // Mostly-normal returns: enough variation that γ4 is near zero, so the
    // formula's denominator stays positive across our test SR range.
    const r = [
      0.01, -0.008, 0.015, 0.003, -0.012, 0.007, -0.002, 0.011, -0.004, 0.006,
      0.013, -0.009, 0.005, -0.001, 0.008, -0.006, 0.012, 0.004, -0.011, 0.009,
      -0.003, 0.014, 0.002, -0.007, 0.01, 0.006, -0.005, 0.008, -0.002, 0.011,
    ];
    const psrLow = probabilisticSharpe(r, 0.3);
    const psrHigh = probabilisticSharpe(r, 0.9);
    expect(psrLow).not.toBeNull();
    expect(psrHigh).not.toBeNull();
    expect(psrLow!).toBeGreaterThan(0);
    expect(psrLow!).toBeLessThan(1);
    expect(psrHigh!).toBeGreaterThan(psrLow!);
  });

  it('PSR > 0.5 when observed > benchmark with enough observations', () => {
    const r = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 0.01 : 0.012));
    const psr = probabilisticSharpe(r, 1.0, 0)!;
    expect(psr).toBeGreaterThan(0.5);
  });

  it('PSR is in [0, 1] for reasonable inputs', () => {
    const r = Array.from({ length: 100 }, () => Math.random() * 0.04 - 0.02);
    const psr = probabilisticSharpe(r, 1.0, 0);
    if (psr !== null) {
      expect(psr).toBeGreaterThanOrEqual(0);
      expect(psr).toBeLessThanOrEqual(1);
    }
  });
});
