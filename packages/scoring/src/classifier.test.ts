import { describe, expect, it } from 'vitest';
import {
  classifyAssetClass,
  classifyCadence,
  classifyHeat,
  classifyMainTag,
  classifyRisk,
  classifySize,
  type ClassifierInputs,
} from './classifier.js';

const baseInputs: ClassifierInputs = {
  totalTrades: 0,
  activeDays: 0,
  firstSeenDaysAgo: 100,
  lastTradeDaysAgo: 0,
  psr: 0,
  maxDrawdownPct: 0.2,
  assetConcentration: 0,
  tradesPerDayAvg: 0,
  primaryAsset: null,
  primaryAssetClass: null,
  avgHoldSeconds: null,
  totalVolumeUsd: 0,
  recentRollingSharpe: null,
  peakRollingSharpe: null,
  longShortRatio: null,
  fundingPnlPct: null,
};

describe('classifyMainTag', () => {
  it('returns null for an unclassified low-sample wallet', () => {
    expect(classifyMainTag(baseInputs)).toBeNull();
  });

  it('classifies fresh + concentrated + low-cadence as insider', () => {
    expect(
      classifyMainTag({
        ...baseInputs,
        firstSeenDaysAgo: 30,
        assetConcentration: 0.8,
        tradesPerDayAvg: 2,
        totalTrades: 10,
      }),
    ).toBe('insider');
  });

  it('classifies dominant-asset 50+ trades as specialist (when not insider)', () => {
    expect(
      classifyMainTag({
        ...baseInputs,
        firstSeenDaysAgo: 200,
        assetConcentration: 0.8,
        totalTrades: 100,
      }),
    ).toBe('specialist');
  });

  it('classifies 500+ trades / 365+ days / PSR≥0.8 as veteran', () => {
    expect(
      classifyMainTag({
        ...baseInputs,
        firstSeenDaysAgo: 500,
        totalTrades: 600,
        activeDays: 400,
        psr: 0.85,
        assetConcentration: 0.4,
      }),
    ).toBe('veteran');
  });

  it('classifies PSR>0.95 + ≥100 trades + ≥90 days + DD<30% as alpha_hunter', () => {
    expect(
      classifyMainTag({
        ...baseInputs,
        firstSeenDaysAgo: 200,
        totalTrades: 150,
        activeDays: 120,
        psr: 0.97,
        maxDrawdownPct: 0.2,
        assetConcentration: 0.4,
      }),
    ).toBe('alpha_hunter');
  });

  it('classifies <50 trades + PSR>0.9 + recent activity as dark_horse', () => {
    expect(
      classifyMainTag({
        ...baseInputs,
        firstSeenDaysAgo: 200,
        totalTrades: 30,
        psr: 0.93,
        lastTradeDaysAgo: 3,
        assetConcentration: 0.3,
      }),
    ).toBe('dark_horse');
  });
});

describe('classifyCadence', () => {
  it('null when hold unknown', () => {
    expect(classifyCadence(null)).toBeNull();
  });
  it('< 5 min ⇒ scalp', () => {
    expect(classifyCadence(60)).toBe('scalp');
  });
  it('< 24h ⇒ intraday', () => {
    expect(classifyCadence(3600)).toBe('intraday');
  });
  it('< 7d ⇒ swing', () => {
    expect(classifyCadence(2 * 86400)).toBe('swing');
  });
  it('≥ 7d ⇒ position', () => {
    expect(classifyCadence(10 * 86400)).toBe('position');
  });
});

describe('classifyRisk', () => {
  it('< 15% DD ⇒ conservative', () => {
    expect(classifyRisk(0.1, null)).toBe('conservative');
  });
  it('< 40% DD ⇒ balanced', () => {
    expect(classifyRisk(0.3, null)).toBe('balanced');
  });
  it('≥ 40% DD ⇒ aggressive', () => {
    expect(classifyRisk(0.6, null)).toBe('aggressive');
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
