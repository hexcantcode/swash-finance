import { describe, expect, it } from 'vitest';
import {
  computeComposite,
  computeDecayFlag,
  medianComposite,
  type CompositeInputs,
} from './composite.js';
import { buildDailySeries, toDailyReturns } from './returns.js';
import {
  annualizedSortino,
  calmar,
  dailySharpe,
  expectancy,
  maxDrawdownPct,
  profitFactor,
  recoveryTimeDays,
} from './metrics.js';
import { monthlyConsistency } from './consistency.js';
import { trackRecordMultiplier } from './track-record.js';

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

const fullBasket = {
  sharpe: 0.2,
  sortino: 0.28,
  calmar: 6,
  psr: 0.97,
  dsr: 0.8,
  profitFactor: 2,
  expectancy: 50,
  maxDrawdownPct: 0.1,
  recoveryTimeDays: 7,
  monthlyConsistency: 0.9,
} as const;

describe('medianComposite', () => {
  it('strong basket with long history => high score, not provisional, 10-entry breakdown', () => {
    const r = medianComposite({ metrics: { ...fullBasket }, activeDays: 400 });
    expect(r.score).toBeGreaterThan(75);
    expect(r.provisional).toBe(false);
    expect(r.confidence).toBe(1);
    expect(r.breakdown).toHaveLength(10);
    expect(r.breakdown.every((b) => b.score !== null)).toBe(true);
  });

  it('confidence cap shrinks the score for thin history & flags provisional', () => {
    const long = medianComposite({ metrics: { ...fullBasket }, activeDays: 400 });
    const short = medianComposite({ metrics: { ...fullBasket }, activeDays: 30 });
    expect(short.provisional).toBe(true);
    expect(short.confidence).toBeCloseTo(30 / 90, 10);
    expect(short.score).toBe(Math.round(long.rawScore * (30 / 90)));
  });

  it('an outlier metric does not blow up the median', () => {
    const clean = medianComposite({ metrics: { ...fullBasket }, activeDays: 400 }).score;
    const withGarbage = medianComposite({
      metrics: { ...fullBasket, sharpe: -1 },
      activeDays: 400,
    }).score;
    expect(Math.abs(withGarbage - clean)).toBeLessThan(8);
  });

  it('nulls are dropped from the basket (median over the rest)', () => {
    const r = medianComposite({ metrics: { ...fullBasket, dsr: null }, activeDays: 400 });
    expect(r.breakdown).toHaveLength(10);
    expect(r.breakdown.find((b) => b.key === 'dsr')!.score).toBeNull();
    expect(r.breakdown.filter((b) => b.score !== null)).toHaveLength(9);
  });

  it('empty / all-null basket => score 0', () => {
    expect(medianComposite({ metrics: {}, activeDays: 400 }).score).toBe(0);
    expect(medianComposite({ metrics: { sharpe: null, dsr: null }, activeDays: 400 }).score).toBe(
      0,
    );
  });

  it('odd number of present metrics => true median (middle value)', () => {
    const r = medianComposite({
      metrics: { sharpe: 0.1, calmar: 6, profitFactor: 2 },
      activeDays: 400,
    });
    const present = r.breakdown
      .map((b) => b.score)
      .filter((s): s is number => s !== null)
      .sort((a, b) => a - b);
    expect(present).toHaveLength(3);
    expect(r.rawScore).toBe(present[1]);
  });
});

describe('end-to-end: returns -> metrics -> medianComposite', () => {
  it('a tidy, long, mildly-choppy winning series scores well and is not provisional', () => {
    const start = Date.UTC(2024, 0, 1);
    // ~200 trading days: a winning day most of the time, a real losing day every
    // 9th day (so months stay positive but the equity curve isn't a straight
    // line — drawdowns recover, recoveryTimeDays/calmar are real, not null).
    const fills = Array.from({ length: 200 }, (_, i) => ({
      blockTimeMs: start + i * 86_400_000,
      closedPnl: (i % 9 === 0 ? -20 : 12).toString(),
      fee: '0.5',
      sz: '1',
      px: '100',
    }));
    const series = buildDailySeries({ fills, fundings: [], ledger: [] });
    const returns = toDailyReturns(series, 10_000);
    const days = series.activeDays;
    const mult = trackRecordMultiplier(days);
    const perTradePnl = fills.map((f) => Number.parseFloat(f.closedPnl) - Number.parseFloat(f.fee));
    const sortinoAnn = annualizedSortino(returns);
    const r = medianComposite({
      metrics: {
        sharpe: (dailySharpe(returns) ?? 0) * mult,
        sortino: ((sortinoAnn ?? 0) / Math.sqrt(365)) * mult,
        calmar: calmar(returns),
        psr: null, // computed in the worker with the trial population — not here
        dsr: null,
        profitFactor: profitFactor(returns),
        expectancy: expectancy(perTradePnl),
        maxDrawdownPct: maxDrawdownPct(returns),
        recoveryTimeDays: recoveryTimeDays(returns),
        monthlyConsistency: monthlyConsistency(
          series.daily.map((dd) => ({ dayKey: dd.dayKey, pnl: dd.pnl })),
        ),
      },
      activeDays: days,
    });

    // 200 daily fills => 200 active days, well past the 90-day confidence cap.
    expect(days).toBe(200);
    expect(r.provisional).toBe(false);
    expect(r.confidence).toBe(1);
    expect(r.breakdown).toHaveLength(10);
    // psr/dsr are null here; the other 8 metrics must all resolve.
    expect(r.breakdown.filter((b) => b.score !== null)).toHaveLength(8);
    // A consistently profitable, low-drawdown trader with 8 months of history
    // should land comfortably in the top band — not just clear a token bar.
    expect(r.score).toBeGreaterThan(80);
  });
});
