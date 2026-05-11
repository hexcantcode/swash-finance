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
  dailySharpe,
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
  psr: 0.97,
  profitFactor: 2,
  maxDrawdownPct: 0.1,
  recoveryTimeDays: 7,
  monthlyConsistency: 0.9,
} as const;

describe('medianComposite', () => {
  it('strong basket with long history => high score, not provisional, 7-entry breakdown', () => {
    const r = medianComposite({ metrics: { ...fullBasket }, daysOfData: 400 });
    // CALIBRATED 2026-05-11: against real HL distributions this fixture's metric
    // values land roughly p55–p85 per metric, so the median sub-score is ~69 —
    // a solid top-third wallet, not a 90+ outlier. (Was `> 75` under the old
    // provisional curves.)
    expect(r.score).toBeGreaterThan(65);
    expect(r.provisional).toBe(false);
    expect(r.confidence).toBe(1);
    expect(r.breakdown).toHaveLength(7);
    expect(r.breakdown.every((b) => b.score !== null)).toBe(true);
  });

  it('confidence cap shrinks the score for thin calendar span & flags provisional', () => {
    const long = medianComposite({ metrics: { ...fullBasket }, daysOfData: 400 });
    const short = medianComposite({ metrics: { ...fullBasket }, daysOfData: 30 });
    expect(long.confidence).toBe(1);
    expect(long.provisional).toBe(false);
    expect(short.provisional).toBe(true);
    expect(short.confidence).toBeCloseTo(1 / 3, 10);
    expect(short.score).toBe(Math.round(long.rawScore * (1 / 3)));
  });

  it('an outlier metric does not blow up the median', () => {
    const clean = medianComposite({ metrics: { ...fullBasket }, daysOfData: 400 }).score;
    const withGarbage = medianComposite({
      metrics: { ...fullBasket, sharpe: -1 },
      daysOfData: 400,
    }).score;
    expect(Math.abs(withGarbage - clean)).toBeLessThan(8);
  });

  it('nulls are dropped from the basket (median over the rest => 6 present)', () => {
    const r = medianComposite({ metrics: { ...fullBasket, psr: null }, daysOfData: 400 });
    expect(r.breakdown).toHaveLength(7);
    expect(r.breakdown.find((b) => b.key === 'psr')!.score).toBeNull();
    expect(r.breakdown.filter((b) => b.score !== null)).toHaveLength(6);
  });

  it('empty / all-null basket => score 0', () => {
    expect(medianComposite({ metrics: {}, daysOfData: 400 }).score).toBe(0);
    expect(medianComposite({ metrics: { sharpe: null, psr: null }, daysOfData: 400 }).score).toBe(
      0,
    );
  });

  it('odd number of present metrics => true median (middle value)', () => {
    const r = medianComposite({
      metrics: { sharpe: 0.1, profitFactor: 2, monthlyConsistency: 0.9 },
      daysOfData: 400,
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
    // line — drawdowns recover, recoveryTimeDays is real, not null).
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
    const daysOfData =
      series.firstEventMs !== null && series.lastEventMs !== null
        ? (series.lastEventMs - series.firstEventMs) / 86_400_000
        : 0;
    const mult = trackRecordMultiplier(days);
    const sortinoAnn = annualizedSortino(returns);
    const r = medianComposite({
      metrics: {
        sharpe: (dailySharpe(returns) ?? 0) * mult,
        sortino: ((sortinoAnn ?? 0) / Math.sqrt(365)) * mult,
        psr: null, // computed in the worker with the trial population — not here
        profitFactor: profitFactor(returns),
        maxDrawdownPct: maxDrawdownPct(returns),
        recoveryTimeDays: recoveryTimeDays(returns),
        monthlyConsistency: monthlyConsistency(
          series.daily.map((dd) => ({ dayKey: dd.dayKey, pnl: dd.pnl })),
        ),
      },
      daysOfData,
    });

    // 200 consecutive daily fills => calendar span ~199 days, past the 90-day cap.
    expect(days).toBe(200);
    expect(daysOfData).toBe(199);
    expect(r.provisional).toBe(false);
    expect(r.confidence).toBe(1);
    expect(r.breakdown).toHaveLength(7);
    // psr is null here; the other 6 metrics must all resolve.
    expect(r.breakdown.filter((b) => b.score !== null)).toHaveLength(6);
    // A consistently profitable, low-drawdown trader with 8 months of history
    // should land comfortably in the top band — not just clear a token bar.
    expect(r.score).toBeGreaterThan(70);
  });
});
