import { describe, expect, it } from 'vitest';
import { computeBehavioral } from './behavioral.js';

const day = (n: number) => Date.UTC(2026, 0, n);

describe('computeBehavioral', () => {
  it('returns zeros for empty fills', () => {
    const m = computeBehavioral([], { activeDays: 0 });
    expect(m.uniqueAssets).toBe(0);
    expect(m.makerTakerRatio).toBe(0);
    expect(m.assetConcentration).toBe(0);
    expect(m.roundTrips).toBe(0);
    expect(m.primaryAsset).toBeNull();
    expect(m.longShortRatio).toBeNull();
  });

  it('Herfindahl is 1.0 when all volume is in one asset', () => {
    const m = computeBehavioral(
      [
        { blockTimeMs: day(1), coin: 'BTC', side: 'B', px: '50000', sz: '1', startPosition: 0, crossed: true },
        { blockTimeMs: day(2), coin: 'BTC', side: 'A', px: '51000', sz: '1', startPosition: '1', crossed: true },
      ],
      { activeDays: 2 },
    );
    expect(m.assetConcentration).toBeCloseTo(1, 4);
    expect(m.primaryAsset).toBe('BTC');
  });

  it('Herfindahl is < 1 when volume is split across assets', () => {
    const m = computeBehavioral(
      [
        { blockTimeMs: day(1), coin: 'BTC', side: 'B', px: '50000', sz: '1', startPosition: 0, crossed: true },
        { blockTimeMs: day(2), coin: 'ETH', side: 'B', px: '3000', sz: '16.667', startPosition: 0, crossed: true },
      ],
      { activeDays: 2 },
    );
    expect(m.assetConcentration).toBeLessThan(0.6);
    expect(m.uniqueAssets).toBe(2);
  });

  it('makerTakerRatio reflects maker fills (crossed=false)', () => {
    const m = computeBehavioral(
      [
        // taker (crossed=true) — counts toward total only
        { blockTimeMs: day(1), coin: 'BTC', side: 'B', px: '100', sz: '1', startPosition: 0, crossed: true },
        // maker (crossed=false) — counts toward maker AND total
        { blockTimeMs: day(2), coin: 'BTC', side: 'A', px: '100', sz: '3', startPosition: '1', crossed: false },
      ],
      { activeDays: 2 },
    );
    expect(m.makerTakerRatio).toBeCloseTo(300 / 400, 4); // 3*100 / (1*100 + 3*100)
  });

  it('long/short ratio is sum(buy) / sum(sell)', () => {
    const m = computeBehavioral(
      [
        { blockTimeMs: day(1), coin: 'BTC', side: 'B', px: '1', sz: '4', startPosition: 0, crossed: true },
        { blockTimeMs: day(2), coin: 'BTC', side: 'A', px: '1', sz: '2', startPosition: '4', crossed: true },
      ],
      { activeDays: 2 },
    );
    expect(m.longShortRatio).toBeCloseTo(2, 4);
  });

  it('avgHoldSeconds estimates FIFO hold from open to close', () => {
    const m = computeBehavioral(
      [
        { blockTimeMs: day(1), coin: 'BTC', side: 'B', px: '1', sz: '1', startPosition: 0, crossed: true },
        // Closes 86400s later (1 day)
        { blockTimeMs: day(2), coin: 'BTC', side: 'A', px: '1', sz: '1', startPosition: '1', crossed: true },
      ],
      { activeDays: 2 },
    );
    expect(m.avgHoldSeconds).toBe(86400);
  });

  it('roundTrips counts only fills that take a position flat (partial reductions do not)', () => {
    const m = computeBehavioral(
      [
        // open long 3
        { blockTimeMs: day(1), coin: 'BTC', side: 'B', px: '1', sz: '3', startPosition: 0, crossed: true },
        // reduce to 1 — not flat, no round trip
        { blockTimeMs: day(2), coin: 'BTC', side: 'A', px: '1', sz: '2', startPosition: '3', crossed: true },
        // reduce to 0 — round trip #1
        { blockTimeMs: day(3), coin: 'BTC', side: 'A', px: '1', sz: '1', startPosition: '1', crossed: true },
        // open short 1
        { blockTimeMs: day(4), coin: 'BTC', side: 'A', px: '1', sz: '1', startPosition: 0, crossed: true },
        // buy 3 — flips through zero to +2 — round trip #2
        { blockTimeMs: day(5), coin: 'BTC', side: 'B', px: '1', sz: '3', startPosition: '-1', crossed: true },
        // independent ETH round trip — #3
        { blockTimeMs: day(6), coin: 'ETH', side: 'B', px: '1', sz: '1', startPosition: 0, crossed: true },
        { blockTimeMs: day(7), coin: 'ETH', side: 'A', px: '1', sz: '1', startPosition: '1', crossed: true },
      ],
      { activeDays: 7 },
    );
    expect(m.roundTrips).toBe(3);
  });
});
