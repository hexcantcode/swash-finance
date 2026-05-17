import { describe, expect, it } from 'vitest';
import { passesGate, type GateInputs } from './gate.js';

/** A wallet that passes all three gates. */
function eligibleInputs(overrides: Partial<GateInputs> = {}): GateInputs {
  return {
    accountValueUsd: 50_000,
    lastFillMs: Date.now() - 24 * 60 * 60 * 1000, // 1d ago
    isMarketMaker: false,
    nowMs: Date.now(),
    ...overrides,
  };
}

describe('passesGate', () => {
  it('clears all three rules ⇒ passed=true, no failures', () => {
    const r = passesGate(eligibleInputs());
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });

  describe('equity rule (>= $50k)', () => {
    it('exactly $50k ⇒ passes', () => {
      const r = passesGate(eligibleInputs({ accountValueUsd: 50_000 }));
      expect(r.passed).toBe(true);
    });

    it('just under $50k ⇒ fails with equity_below_min', () => {
      const r = passesGate(eligibleInputs({ accountValueUsd: 49_999 }));
      expect(r.passed).toBe(false);
      expect(r.failures).toContain('equity_below_min');
    });

    it('mid-band $25k (old floor) ⇒ fails with equity_below_min', () => {
      const r = passesGate(eligibleInputs({ accountValueUsd: 25_000 }));
      expect(r.passed).toBe(false);
      expect(r.failures).toContain('equity_below_min');
    });

    it('null equity ⇒ fails with equity_below_min', () => {
      const r = passesGate(eligibleInputs({ accountValueUsd: null }));
      expect(r.passed).toBe(false);
      expect(r.failures).toContain('equity_below_min');
    });
  });

  describe('activity rule (last fill within 30d)', () => {
    it('fill 29 days ago ⇒ passes', () => {
      const now = Date.now();
      const r = passesGate(
        eligibleInputs({ nowMs: now, lastFillMs: now - 29 * 24 * 60 * 60 * 1000 }),
      );
      expect(r.passed).toBe(true);
    });

    it('fill 31 days ago ⇒ fails with inactive_30d', () => {
      const now = Date.now();
      const r = passesGate(
        eligibleInputs({ nowMs: now, lastFillMs: now - 31 * 24 * 60 * 60 * 1000 }),
      );
      expect(r.passed).toBe(false);
      expect(r.failures).toContain('inactive_30d');
    });

    it('null lastFillMs ⇒ fails with inactive_30d (no recorded activity)', () => {
      const r = passesGate(eligibleInputs({ lastFillMs: null }));
      expect(r.passed).toBe(false);
      expect(r.failures).toContain('inactive_30d');
    });
  });

  describe('bot rule (not market-maker)', () => {
    it('isMarketMaker=true ⇒ fails with market_maker_pattern', () => {
      const r = passesGate(eligibleInputs({ isMarketMaker: true }));
      expect(r.passed).toBe(false);
      expect(r.failures).toContain('market_maker_pattern');
    });
  });

  describe('multiple failures', () => {
    it('all three gates failing ⇒ all three reasons surface', () => {
      const r = passesGate({
        accountValueUsd: 1_000,
        lastFillMs: null,
        isMarketMaker: true,
        nowMs: Date.now(),
      });
      expect(r.passed).toBe(false);
      expect(r.failures).toEqual(
        expect.arrayContaining(['equity_below_min', 'inactive_30d', 'market_maker_pattern']),
      );
      expect(r.failures).toHaveLength(3);
    });
  });
});
