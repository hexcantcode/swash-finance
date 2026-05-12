import { describe, expect, it } from 'vitest';
import {
  classifyAssetClass,
  classifyHeat,
  classifyProfile,
  classifySize,
  type ProfileInputs,
} from './classifier.js';

// A wallet that matches no archetype: tiny sample, no PSR, diversified.
const base: ProfileInputs = {
  roundTrips: 20,
  daysOfData: 40,
  lastTradeDaysAgo: 1,
  psr: null,
  maxDrawdownPct: 0.2,
  assetConcentration: 0.2,
  tradesPerDayAvg: 1,
  primaryAssetClass: 'altcoin',
  monthlyConsistency: 0.3,
  rolling30dSharpe: null,
  peakRollingSharpe: null,
  accountValueUsd: 1_000_000,
};

describe('classifyProfile', () => {
  it('falls through to allrounder when nothing matches', () => {
    expect(classifyProfile(base)).toBe('allrounder');
  });

  it('alpha: concentrated, low-cadence, lethal PSR, controlled DD, non-bluechip', () => {
    expect(
      classifyProfile({
        ...base,
        assetConcentration: 0.8,
        tradesPerDayAvg: 2,
        roundTrips: 30,
        psr: 0.96,
        maxDrawdownPct: 0.2,
        primaryAssetClass: 'altcoin',
        lastTradeDaysAgo: 3,
      }),
    ).toBe('alpha');
  });

  it('not alpha if the primary market is bluechip', () => {
    expect(
      classifyProfile({
        ...base,
        assetConcentration: 0.8,
        tradesPerDayAvg: 2,
        roundTrips: 30,
        psr: 0.96,
        maxDrawdownPct: 0.2,
        primaryAssetClass: 'bluechip',
      }),
    ).not.toBe('alpha');
  });

  it('not alpha if drawdown is uncontrolled — falls to specialist', () => {
    expect(
      classifyProfile({
        ...base,
        assetConcentration: 0.8,
        roundTrips: 60,
        psr: 0.96,
        maxDrawdownPct: 0.5,
        primaryAssetClass: 'altcoin',
      }),
    ).toBe('specialist');
  });

  it('veteran: long span, big sample, consistent, decent PSR', () => {
    expect(
      classifyProfile({
        ...base,
        daysOfData: 75,
        roundTrips: 800,
        monthlyConsistency: 0.7,
        psr: 0.85,
        assetConcentration: 0.3,
      }),
    ).toBe('veteran');
  });

  it('rising_star: small book near the floor, short record, recent Sharpe near peak', () => {
    expect(
      classifyProfile({
        ...base,
        accountValueUsd: 60_000,
        daysOfData: 50,
        roundTrips: 40,
        psr: 0.9,
        rolling30dSharpe: 1.8,
        peakRollingSharpe: 2.0,
        lastTradeDaysAgo: 5,
        assetConcentration: 0.3,
      }),
    ).toBe('rising_star');
  });

  it('not rising_star once the book is large ($300k) — diversified ⇒ allrounder', () => {
    expect(
      classifyProfile({
        ...base,
        accountValueUsd: 300_000,
        daysOfData: 50,
        roundTrips: 40,
        psr: 0.9,
        rolling30dSharpe: 1.8,
        peakRollingSharpe: 2.0,
        assetConcentration: 0.3,
      }),
    ).toBe('allrounder');
  });

  it('rising_star needs a known account value', () => {
    expect(
      classifyProfile({
        ...base,
        accountValueUsd: null,
        daysOfData: 50,
        roundTrips: 40,
        psr: 0.9,
        rolling30dSharpe: 1.8,
        peakRollingSharpe: 2.0,
        assetConcentration: 0.3,
      }),
    ).toBe('allrounder');
  });

  it('specialist: concentrated, enough round-trips, no info edge', () => {
    expect(
      classifyProfile({
        ...base,
        assetConcentration: 0.75,
        roundTrips: 120,
        psr: 0.4,
        primaryAssetClass: 'altcoin',
      }),
    ).toBe('specialist');
  });

  it('quality archetypes beat behavioral ones: a high-PSR concentrated wallet is alpha, not specialist', () => {
    const inputs: ProfileInputs = {
      ...base,
      assetConcentration: 0.8,
      roundTrips: 60,
      tradesPerDayAvg: 2,
      psr: 0.97,
      maxDrawdownPct: 0.2,
      primaryAssetClass: 'altcoin',
      lastTradeDaysAgo: 2,
    };
    expect(classifyProfile(inputs)).toBe('alpha');
  });
});

describe('classifyHeat', () => {
  it('null when peak unknown', () => {
    expect(classifyHeat(0.5, null)).toBeNull();
  });
  it('hot when recent ≥ 85% of peak', () => {
    expect(classifyHeat(0.9, 1.0)).toBe('hot');
  });
  it('steady when recent ≥ 50% of peak', () => {
    expect(classifyHeat(0.6, 1.0)).toBe('steady');
  });
  it('cooling when recent < 50% of peak', () => {
    expect(classifyHeat(0.3, 1.0)).toBe('cooling');
  });
});

describe('classifySize', () => {
  it('whale at $100M+', () => {
    expect(classifySize(150_000_000)).toBe('whale');
  });
  it('mid at $10M+', () => {
    expect(classifySize(15_000_000)).toBe('mid');
  });
  it('small at $1M+', () => {
    expect(classifySize(2_000_000)).toBe('small');
  });
  it('micro below $1M', () => {
    expect(classifySize(500_000)).toBe('micro');
  });
});

describe('classifyAssetClass', () => {
  const hip3 = new Set(['stocks-dex', 'fx-dex']);

  it('classifies BTC/ETH/SOL as bluechip', () => {
    expect(classifyAssetClass('BTC', hip3)).toBe('bluechip');
    expect(classifyAssetClass('ETH', hip3)).toBe('bluechip');
    expect(classifyAssetClass('SOL', hip3)).toBe('bluechip');
  });

  it('classifies PEPE/DOGE/WIF as meme', () => {
    expect(classifyAssetClass('PEPE', hip3)).toBe('meme');
    expect(classifyAssetClass('DOGE', hip3)).toBe('meme');
    expect(classifyAssetClass('WIF', hip3)).toBe('meme');
  });

  it('classifies HIP-3 stocks-dex coins as stocks', () => {
    expect(classifyAssetClass('stocks-dex:NVDA', hip3)).toBe('stocks');
  });

  it('falls back to altcoin for everything else', () => {
    expect(classifyAssetClass('LINK', hip3)).toBe('altcoin');
    expect(classifyAssetClass('ARB', hip3)).toBe('altcoin');
  });
});
