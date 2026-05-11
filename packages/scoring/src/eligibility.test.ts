import { describe, expect, it } from 'vitest';
import { evaluateEligibility, type EligibilityInputs } from './eligibility.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 4, 11);

function eligibleInputs(overrides: Partial<EligibilityInputs> = {}): EligibilityInputs {
  return {
    accountValueUsd: 50_000,
    totalVolumeUsd: 5_000_000,
    firstSeenMs: NOW - 200 * DAY_MS,
    activeDays: 90,
    roundTripTrades: 200,
    capitalBaseKnown: true,
    makerShare: 0.2,
    avgHoldSeconds: 3600,
    longShortRatio: 0.5,
    totalFills: 400,
    nowMs: NOW,
    ...overrides,
  };
}

describe('evaluateEligibility', () => {
  it('returns eligible:true with no failures for a fully eligible wallet', () => {
    expect(evaluateEligibility(eligibleInputs())).toEqual({ eligible: true, failures: [] });
  });

  it('fails when accountValue is below the floor ($5k)', () => {
    const r = evaluateEligibility(eligibleInputs({ accountValueUsd: 5_000 }));
    expect(r.eligible).toBe(false);
    expect(r.failures).toEqual(['account_value_below_floor']);
  });

  it('fails when accountValue is null', () => {
    const r = evaluateEligibility(eligibleInputs({ accountValueUsd: null }));
    expect(r.eligible).toBe(false);
    expect(r.failures).toContain('account_value_below_floor');
  });

  it('fails when volume is below the floor ($50k)', () => {
    const r = evaluateEligibility(eligibleInputs({ totalVolumeUsd: 50_000 }));
    expect(r.eligible).toBe(false);
    expect(r.failures).toEqual(['volume_below_floor']);
  });

  it('fails when volume is null', () => {
    const r = evaluateEligibility(eligibleInputs({ totalVolumeUsd: null }));
    expect(r.eligible).toBe(false);
    expect(r.failures).toContain('volume_below_floor');
  });

  it('fails when track record is too short (firstSeen 30 days ago)', () => {
    const r = evaluateEligibility(eligibleInputs({ firstSeenMs: NOW - 30 * DAY_MS }));
    expect(r.eligible).toBe(false);
    expect(r.failures).toEqual(['track_record_too_short']);
  });

  it('passes the track-record check at exactly 90 days', () => {
    const r = evaluateEligibility(eligibleInputs({ firstSeenMs: NOW - 90 * DAY_MS }));
    expect(r.failures).not.toContain('track_record_too_short');
  });

  it('fails when activeDays is below 30', () => {
    const r = evaluateEligibility(eligibleInputs({ activeDays: 10 }));
    expect(r.eligible).toBe(false);
    expect(r.failures).toEqual(['too_few_active_days']);
  });

  it('fails when roundTripTrades is below the minimum', () => {
    const r = evaluateEligibility(eligibleInputs({ roundTripTrades: 5 }));
    expect(r.eligible).toBe(false);
    expect(r.failures).toEqual(['too_few_round_trips']);
  });

  it('skips the round-trip check when roundTripTrades is null', () => {
    const r = evaluateEligibility(eligibleInputs({ roundTripTrades: null }));
    expect(r.eligible).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('fails when the capital base is unknown', () => {
    const r = evaluateEligibility(eligibleInputs({ capitalBaseKnown: false }));
    expect(r.eligible).toBe(false);
    expect(r.failures).toEqual(['capital_base_unknown']);
  });

  it('flags a market-maker / grid-bot pattern when ALL signals are present and extreme', () => {
    const r = evaluateEligibility(
      eligibleInputs({ makerShare: 0.99, avgHoldSeconds: 5, longShortRatio: 0.5, totalFills: 5000 }),
    );
    expect(r.eligible).toBe(false);
    expect(r.failures).toEqual(['market_maker_pattern']);
  });

  it('does not flag MM pattern when there are not enough fills', () => {
    const r = evaluateEligibility(
      eligibleInputs({ makerShare: 0.99, avgHoldSeconds: 5, longShortRatio: 0.5, totalFills: 200 }),
    );
    expect(r.failures).not.toContain('market_maker_pattern');
  });

  it('does not flag MM pattern when avgHoldSeconds is null (signal missing)', () => {
    const r = evaluateEligibility(
      eligibleInputs({ makerShare: 0.99, avgHoldSeconds: null, longShortRatio: 0.5, totalFills: 5000 }),
    );
    expect(r.failures).not.toContain('market_maker_pattern');
  });

  it('does not flag MM pattern when long/short ratio is not balanced', () => {
    const r = evaluateEligibility(
      eligibleInputs({ makerShare: 0.99, avgHoldSeconds: 5, longShortRatio: 0.8, totalFills: 5000 }),
    );
    expect(r.failures).not.toContain('market_maker_pattern');
  });

  it('accumulates multiple failures', () => {
    const r = evaluateEligibility(
      eligibleInputs({
        accountValueUsd: 1_000,
        totalVolumeUsd: 10_000,
        activeDays: 3,
        capitalBaseKnown: false,
      }),
    );
    expect(r.eligible).toBe(false);
    expect(r.failures).toEqual(
      expect.arrayContaining([
        'account_value_below_floor',
        'volume_below_floor',
        'too_few_active_days',
        'capital_base_unknown',
      ]),
    );
    expect(r.failures).toHaveLength(4);
  });

  it('defaults nowMs to Date.now() when omitted', () => {
    const { nowMs, ...rest } = eligibleInputs({ firstSeenMs: Date.now() - 200 * DAY_MS });
    void nowMs;
    expect(evaluateEligibility(rest)).toEqual({ eligible: true, failures: [] });
  });
});
