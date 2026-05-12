import { describe, expect, it } from 'vitest';
import { computeCopyability, type CopyabilityInputs } from './copyability.js';

/** A trader who maxes out every copyability dimension. */
function idealInputs(overrides: Partial<CopyabilityInputs> = {}): CopyabilityInputs {
  return {
    accountValueUsd: 1_000_000,
    roundTrips: 500,
    daysOfData: 800,
    leverage: 3,
    assetConcentration: 0.2,
    maxDrawdownPct: 0.1,
    isMarketMaker: false,
    capitalBaseKnown: true,
    ...overrides,
  };
}

describe('computeCopyability', () => {
  it('a deeply-eligible, sane-leverage whale ⇒ value 1.0', () => {
    const r = computeCopyability(idealInputs());
    expect(r.value).toBeCloseTo(1, 5);
    expect(r.breakdown.excluded).toBe(false);
    expect(r.breakdown.penalties).toEqual([]);
  });

  it('leverage over the hard cap ⇒ value 0, excluded', () => {
    const r = computeCopyability(idealInputs({ leverage: 22 }));
    expect(r.value).toBe(0);
    expect(r.breakdown.excluded).toBe(true);
  });

  it('market-maker pattern ⇒ value 0, excluded (even if everything else is perfect)', () => {
    const r = computeCopyability(idealInputs({ isMarketMaker: true }));
    expect(r.value).toBe(0);
    expect(r.breakdown.excluded).toBe(true);
  });

  it('unreconstructable capital base ⇒ value 0, excluded', () => {
    const r = computeCopyability(idealInputs({ capitalBaseKnown: false }));
    expect(r.value).toBe(0);
    expect(r.breakdown.excluded).toBe(true);
  });

  it('equity at/below the $2k floor ⇒ value 0 — hard skin-in-the-game filter, no PnL can rescue it', () => {
    expect(computeCopyability(idealInputs({ accountValueUsd: 2_000 })).value).toBe(0);
    expect(computeCopyability(idealInputs({ accountValueUsd: 0 })).value).toBe(0);
    const r = computeCopyability(idealInputs({ accountValueUsd: 0.69 }));
    expect(r.value).toBe(0);
    expect(r.breakdown.capital).toBe(0);
    expect(r.breakdown.excluded).toBe(true);
  });

  it('barely-eligible trader (old floors, sane leverage) ⇒ value ≈ 0.5 — the capital haircut', () => {
    const r = computeCopyability(
      idealInputs({ accountValueUsd: 10_000, roundTrips: 30, daysOfData: 90, leverage: 3 }),
    );
    expect(r.value).toBeCloseTo(0.5, 2);
    expect(r.breakdown.capital).toBeCloseTo(0.5, 2);
    expect(r.breakdown.sample).toBeCloseTo(1, 5);
    expect(r.breakdown.history).toBeCloseTo(1, 5);
    expect(r.breakdown.mirror).toBeCloseTo(1, 5);
    expect(r.breakdown.excluded).toBe(false);
  });

  it('thin record below the old floors ⇒ value crashes toward 0', () => {
    const r = computeCopyability(
      idealInputs({ accountValueUsd: 4_000, roundTrips: 8, daysOfData: 20 }),
    );
    expect(r.value).toBeLessThan(0.05);
    expect(r.value).toBeGreaterThan(0);
    expect(r.breakdown.excluded).toBe(false);
  });

  it('moderate leverage (10×) applies a soft mirror penalty, no exclusion', () => {
    const r = computeCopyability(idealInputs({ leverage: 10 }));
    expect(r.breakdown.mirror).toBeCloseTo(0.7083, 3);
    expect(r.breakdown.excluded).toBe(false);
    expect(r.breakdown.penalties.length).toBeGreaterThan(0);
    expect(r.value).toBeCloseTo(0.7083, 3);
  });

  it('high single-asset concentration applies a mirror penalty', () => {
    const r = computeCopyability(idealInputs({ assetConcentration: 1.0 }));
    expect(r.breakdown.mirror).toBeCloseTo(0.8, 5);
    expect(r.value).toBeCloseTo(0.8, 5);
    expect(r.breakdown.penalties.length).toBeGreaterThan(0);
  });

  it('unknown leverage (null) ⇒ no leverage penalty — not punished for missing data', () => {
    const r = computeCopyability(idealInputs({ leverage: null }));
    expect(r.breakdown.mirror).toBeCloseTo(1, 5);
    expect(r.value).toBeCloseTo(1, 5);
    expect(r.breakdown.excluded).toBe(false);
  });

  it('null account value / round-trips / non-finite history ⇒ those factors are 0', () => {
    expect(computeCopyability(idealInputs({ accountValueUsd: null })).breakdown.capital).toBe(0);
    expect(computeCopyability(idealInputs({ roundTrips: null })).breakdown.sample).toBe(0);
    expect(computeCopyability(idealInputs({ daysOfData: Number.NaN })).breakdown.history).toBe(0);
  });
});
