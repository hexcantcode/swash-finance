import { describe, expect, it } from 'vitest';
import { computeLeverageProfile, type LeverageFill } from './leverage.js';

function f(
  blockTimeMs: number,
  coin: string,
  side: 'B' | 'A',
  px: number,
  sz: number,
  startPosition: number,
): LeverageFill {
  return { blockTimeMs, coin, side, px: String(px), sz: String(sz), startPosition: String(startPosition) };
}

describe('computeLeverageProfile', () => {
  it('null / non-positive account value ⇒ null', () => {
    const fills = [f(1, 'BTC', 'B', 60_000, 0.5, 0)];
    expect(computeLeverageProfile(fills, null)).toBeNull();
    expect(computeLeverageProfile(fills, 0)).toBeNull();
    expect(computeLeverageProfile(fills, -100)).toBeNull();
  });

  it('no fills ⇒ null', () => {
    expect(computeLeverageProfile([], 10_000)).toBeNull();
  });

  it('a single open to $30k notional on $10k equity ⇒ ~3× gross', () => {
    const r = computeLeverageProfile([f(1, 'BTC', 'B', 60_000, 0.5, 0)], 10_000);
    expect(r).not.toBeNull();
    expect(r!.typicalGross).toBeCloseTo(3, 5);
    expect(r!.maxGross).toBeCloseTo(3, 5);
    expect(r!.avgGross).toBeCloseTo(3, 5);
  });

  it('leverage is only sampled while a position is open (flat ⇒ not sampled)', () => {
    const r = computeLeverageProfile(
      [
        f(1, 'BTC', 'B', 60_000, 0.5, 0), // → 0.5 BTC, gross 30k, lev 3
        f(2, 'BTC', 'A', 60_000, 0.5, 0.5), // → 0 BTC, gross 0, not sampled
        f(3, 'BTC', 'B', 50_000, 0.2, 0), // → 0.2 BTC, gross 10k, lev 1
      ],
      10_000,
    );
    expect(r!.typicalGross).toBeCloseTo(2, 5); // median of [3, 1]
    expect(r!.maxGross).toBeCloseTo(3, 5);
    expect(r!.avgGross).toBeCloseTo(2, 5);
  });

  it('a consistent ~25× degen ⇒ typical ≈ 25×', () => {
    const r = computeLeverageProfile(
      [
        f(1, 'SOL', 'B', 100, 2_500, 0), // 250k notional / 10k = 25
        f(2, 'SOL', 'B', 100, 2_500, 2_500), // 5000 SOL → 500k... too big; instead build up
      ],
      10_000,
    );
    // first sample = 25, second = (5000*100)/10000 = 50 → median 37.5; max 50
    expect(r!.maxGross).toBeGreaterThan(20);
    expect(r!.typicalGross).toBeGreaterThan(20);
  });

  it('multi-coin: gross = sum of |position| notional across coins', () => {
    const r = computeLeverageProfile(
      [
        f(1, 'BTC', 'B', 60_000, 0.5, 0), // BTC 0.5 → gross 30k, lev 0.3 (equity 100k)
        f(2, 'ETH', 'B', 4_000, 5, 0), // ETH 5 (20k) + BTC 0.5 (30k) → gross 50k, lev 0.5
      ],
      100_000,
    );
    expect(r!.typicalGross).toBeCloseTo(0.4, 5); // median of [0.3, 0.5]
    expect(r!.maxGross).toBeCloseTo(0.5, 5);
  });

  it('uses startPosition so it is robust to gaps in the ingested fill history', () => {
    // single sell of 0.3 BTC out of a 1.0 BTC position we never saw opened.
    const r = computeLeverageProfile([f(1, 'BTC', 'A', 50_000, 0.3, 1.0)], 100_000);
    expect(r!.typicalGross).toBeCloseTo(0.35, 5); // (1.0 - 0.3) * 50_000 / 100_000
  });

  it('processes fills chronologically regardless of input order', () => {
    const a = f(1, 'BTC', 'B', 60_000, 0.5, 0);
    const b = f(2, 'BTC', 'A', 60_000, 0.5, 0.5);
    const c = f(3, 'BTC', 'B', 50_000, 0.2, 0);
    const r1 = computeLeverageProfile([a, b, c], 10_000);
    const r2 = computeLeverageProfile([c, a, b], 10_000); // shuffled
    expect(r2!.typicalGross).toBeCloseTo(r1!.typicalGross, 9);
    expect(r2!.maxGross).toBeCloseTo(r1!.maxGross, 9);
  });
});
