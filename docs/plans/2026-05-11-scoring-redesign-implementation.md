# Scoring Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the saturating additive composite with a robust median-of-10-metrics composite (calibrated absolute curves, track-record multiplier on Sharpe/Sortino, confidence cap), fix the always-zero DSR/PSR, and add a calibration tool — all inside `packages/scoring`. Downstream pipeline changes (DB, worker jobs, web) are outlined in §Phase 6+ and get their own plan once Phase 1–2 land.

**Architecture:** `packages/scoring` gains `curves.ts` (per-metric absolute normalization curves, tunable constants), `composite.ts` is rewritten to `medianComposite(...)` over the 10-metric basket, `metrics.ts` gains a track-record multiplier and a monthly-consistency metric, and PSR/DSR are fixed to operate on **per-period (daily) Sharpe** rather than annualized Sharpe. A standalone calibration script (`apps/worker/src/scripts/calibrate-curves.ts`) fetches real HL histories, dumps metric distributions, and is the source of truth for the curve constants.

**Tech stack:** TypeScript (ESM, `.js` import specifiers), vitest, `simple-statistics`, `@copytrade/shared` (Decimal helpers), `pnpm` workspaces. Worktree: `/Users/ege/swash/.worktrees/scoring-redesign`, branch `scoring-redesign`.

**Design reference:** `docs/plans/2026-05-11-swash-scoring-redesign-design.md`.

**Conventions for the implementer:**
- All source files in `packages/scoring/src/`; tests are co-located `*.test.ts`; run with `pnpm --filter @copytrade/scoring test` (or `... test -- <file>` for one file, but vitest's `run` already runs all).
- ESM: every relative import ends in `.js` (e.g. `import { foo } from './curves.js'`) even though the file is `.ts`.
- TDD: write the failing test, run it, see it fail, implement minimal code, run it, see it pass, commit. Small commits.
- Numbers that are placeholders pending calibration MUST be marked `// PROVISIONAL — calibrate (Phase 2)`.
- Don't touch `apps/worker/src/jobs/score.ts` or `apps/web` in Phase 1 — the call-site rewiring is Phase 5+ (the old `computeComposite` stays exported until then so nothing breaks; we add new exports alongside).

---

## Phase 1 — `packages/scoring` rewrite

### Task 1: Fix PSR to operate on per-period (daily) Sharpe

**Background:** `probabilisticSharpe(returns, srObserved, benchmarkSr)` is currently fed the *annualized* Sharpe (`mean/sd × √365 ≈ 3–10`). The skew/kurtosis denominator `√(1 − γ3·SR̂ + (γ4/4)·SR̂²)` and the `√(N−1)` factor are derived for the **non-annualized** Sharpe; passing the annualized one inflates the denominator and pins `Φ(z)` near 1.0 for everyone (matches the DB: every wallet's PSR ≈ 0.99–1.0). Fix: PSR/DSR consume the daily Sharpe; annualization is a display concern only.

**Files:**
- Modify: `packages/scoring/src/metrics.ts` — add `dailySharpe(returns)` (the un-annualized ratio).
- Test: `packages/scoring/src/metrics.test.ts`

**Step 1 — Write failing test** (append to `metrics.test.ts`):
```ts
import { dailySharpe } from './metrics.js';

describe('dailySharpe', () => {
  it('is annualizedSharpe / sqrt(365)', () => {
    const r = [0.01, -0.005, 0.02, 0.0, 0.008, -0.012, 0.015];
    const daily = dailySharpe(r)!;
    const ann = annualizedSharpe(r)!;
    expect(daily).toBeCloseTo(ann / Math.sqrt(365), 10);
  });
  it('returns null for <2 returns or zero variance', () => {
    expect(dailySharpe([0.01])).toBeNull();
    expect(dailySharpe([0.01, 0.01, 0.01])).toBeNull();
  });
});
```

**Step 2 — Run, expect fail:** `pnpm --filter @copytrade/scoring test` → FAIL (`dailySharpe is not a function`).

**Step 3 — Implement** in `metrics.ts`:
```ts
/** Per-period (daily) Sharpe — mean/stdev of daily returns, NOT annualized.
 *  PSR/DSR consume this; annualization is purely a display transform. */
export function dailySharpe(returns: number[]): number | null {
  if (returns.length < 2) return null;
  const sd = sampleStandardDeviation(returns);
  if (sd === 0 || !Number.isFinite(sd)) return null;
  return mean(returns) / sd;
}
```

**Step 4 — Run, expect pass.**

**Step 5 — Commit:** `git add packages/scoring/src/metrics.ts packages/scoring/src/metrics.test.ts && git commit -m "feat(scoring): add dailySharpe (un-annualized) for PSR/DSR"`

---

### Task 2: PSR/DSR call-site contract — document & test the daily-Sharpe usage

**Background:** `probabilisticSharpe` and `deflatedSharpe` already take a generic `srObserved` — the bug is purely in *what the worker passes*. We add tests that pin the intended contract (daily Sharpe in, sensible PSR out) and a doc note, so the Phase-5 worker rewiring can't regress it. No production-logic change here beyond comments.

**Files:**
- Modify: `packages/scoring/src/psr.ts` (doc comment), `packages/scoring/src/dsr.ts` (doc comment).
- Test: `packages/scoring/src/psr.test.ts`, `packages/scoring/src/dsr.test.ts`

**Step 1 — Failing test** (`psr.test.ts`):
```ts
import { dailySharpe } from './metrics.js';
it('with daily Sharpe gives a discriminating PSR (not pinned at 1)', () => {
  // ~300 days, modest edge: daily mean 0.002, sd 0.02 => daily SR 0.1
  const strong = Array.from({ length: 300 }, (_, i) => 0.002 + 0.02 * Math.sin(i));
  const weak   = Array.from({ length: 300 }, (_, i) => 0.0002 + 0.02 * Math.sin(i));
  const psrStrong = probabilisticSharpe(strong, dailySharpe(strong)!, 0)!;
  const psrWeak   = probabilisticSharpe(weak,   dailySharpe(weak)!,   0)!;
  expect(psrStrong).toBeGreaterThan(psrWeak);
  expect(psrWeak).toBeLessThan(0.99);   // would be ~1.0 if fed the annualized SR
});
```

**Step 2 — Run, expect fail** (or pass — if it passes immediately, the assertion still documents intent; keep it). If it *fails*, that means PSR is mis-scaled even on daily input → investigate before proceeding.

**Step 3 — Add doc comments** to `psr.ts` and `dsr.ts`: "`srObserved` MUST be the per-period (daily) Sharpe — see `dailySharpe`. Passing an annualized Sharpe inflates the kurtosis denominator and pins PSR≈1."

**Step 4 — Run, expect pass.**

**Step 5 — Commit:** `git commit -am "test(scoring): pin PSR/DSR daily-Sharpe contract; doc the units"`

---

### Task 3: DSR sanity test — adjusted benchmark in daily units gives a spread

**Files:** Test only: `packages/scoring/src/dsr.test.ts`

**Step 1 — Failing test:**
```ts
import { dailySharpe } from './metrics.js';
it('DSR spreads when benchmark is built from the variance of DAILY Sharpes', () => {
  const series = (m: number) => Array.from({ length: 250 }, (_, i) => m + 0.018 * Math.sin(i / 3));
  const pop = [series(0.0005), series(0.001), series(0.0015), series(0.002), series(0.003)];
  const dailySRs = pop.map((s) => dailySharpe(s)!);
  const variance = dailySRs.reduce((a, x, _, arr) => {
    const mu = arr.reduce((s, y) => s + y, 0) / arr.length;
    return a + (x - mu) ** 2;
  }, 0) / (dailySRs.length - 1);
  const best = pop[4]!, worst = pop[0]!;
  const dsrBest  = deflatedSharpe(best,  dailySharpe(best)!,  { trialCount: 5, srVariance: variance })!;
  const dsrWorst = deflatedSharpe(worst, dailySharpe(worst)!, { trialCount: 5, srVariance: variance })!;
  expect(dsrBest).toBeGreaterThan(dsrWorst);
  expect(dsrBest).toBeGreaterThan(0);          // not pinned at 0 like the current prod bug
});
```

**Step 2 — Run.** If this fails (DSR still 0 everywhere even with daily units), the bug is in `adjustedBenchmarkSharpe` itself — STOP and investigate; possibly the `trialCount` Φ⁻¹ terms dominate for large N and we need to cap/clamp. Document the finding in the design doc's §1.5.

**Step 3 — If it passes:** add a comment in `dsr.ts` referencing this test. If it failed and you fixed `adjustedBenchmarkSharpe`, keep the fix minimal and add a regression test.

**Step 4 — Run, expect pass.**

**Step 5 — Commit:** `git commit -am "test(scoring): DSR produces a spread with daily-unit inputs"`

---

### Task 4: `monthlyConsistency` metric

**Background:** New 10th metric. Input: the per-day series (`{ dayKey: 'YYYY-MM-DD', pnl: Decimal }[]` from `buildDailySeries`). Output: a 0..1 score = fraction of calendar months with non-negative net PnL, with a small penalty for months that are deeply negative (so "11 flat months + 1 −80% month" scores worse than "11 flat + 1 −5%"). Months with no activity are skipped (not counted as wins or losses).

**Files:**
- Create: `packages/scoring/src/consistency.ts`
- Test: `packages/scoring/src/consistency.test.ts`
- Modify: `packages/scoring/src/index.ts` (export it)

**Step 1 — Failing test** (`consistency.test.ts`):
```ts
import { d } from '@copytrade/shared';
import { monthlyConsistency } from './consistency.js';

const day = (dayKey: string, pnl: number) => ({ dayKey, pnl: d(pnl) });

describe('monthlyConsistency', () => {
  it('all profitable months => 1', () => {
    expect(monthlyConsistency([day('2025-01-05', 100), day('2025-02-10', 50), day('2025-03-01', 10)])).toBe(1);
  });
  it('half the months losing => ~0.5', () => {
    expect(monthlyConsistency([day('2025-01-05', 100), day('2025-02-10', -50)])).toBeCloseTo(0.5, 5);
  });
  it('a catastrophic month is penalised below a simple win-rate', () => {
    const mild  = monthlyConsistency([day('2025-01-05', 100), day('2025-02-10', 100), day('2025-03-01', -5)]);
    const harsh = monthlyConsistency([day('2025-01-05', 100), day('2025-02-10', 100), day('2025-03-01', -10_000)]);
    expect(harsh).toBeLessThan(mild);
  });
  it('empty input => 0', () => { expect(monthlyConsistency([])).toBe(0); });
});
```

**Step 2 — Run, expect fail.**

**Step 3 — Implement** `consistency.ts`:
```ts
import { Decimal } from '@copytrade/shared';

export interface DailyPnlRow { dayKey: string; pnl: Decimal; }

/** Fraction of active calendar months that were net non-negative, with each
 *  catastrophic month (loss > 25% of that month's gross turnover... approximated
 *  here as: net more negative than the median positive month) counted as extra
 *  bad. Simpler v1: win-fraction minus a small penalty per deeply-negative month. */
export function monthlyConsistency(rows: DailyPnlRow[]): number {
  if (rows.length === 0) return 0;
  const byMonth = new Map<string, Decimal>();
  for (const r of rows) {
    const m = r.dayKey.slice(0, 7); // YYYY-MM
    byMonth.set(m, (byMonth.get(m) ?? new Decimal(0)).plus(r.pnl));
  }
  const monthly = [...byMonth.values()];
  const n = monthly.length;
  const wins = monthly.filter((v) => v.gte(0)).length;
  const base = wins / n;
  // Penalty: each month whose loss magnitude exceeds the largest winning month
  // costs an extra 1/n (so a single huge blowup roughly cancels a winning month).
  const maxWin = monthly.filter((v) => v.gt(0)).reduce((mx, v) => (v.gt(mx) ? v : mx), new Decimal(0));
  const blowups = monthly.filter((v) => v.lt(0) && v.abs().gt(maxWin)).length;
  return Math.max(0, base - blowups / n);
}
```
*(If calibration later wants something fancier — Sortino-of-monthly-returns, % above a MAR — swap the body; the contract is "rows in, 0..1 out".)*

**Step 4 — Run, expect pass.**

**Step 5 — Commit:** `git add packages/scoring/src/consistency.ts packages/scoring/src/consistency.test.ts packages/scoring/src/index.ts && git commit -m "feat(scoring): monthlyConsistency metric"`

---

### Task 5: Track-record multiplier

**Files:**
- Create: `packages/scoring/src/track-record.ts`
- Test: `packages/scoring/src/track-record.test.ts`
- Modify: `packages/scoring/src/index.ts`

**Step 1 — Failing test:**
```ts
import { trackRecordMultiplier } from './track-record.js';
describe('trackRecordMultiplier', () => {
  it('full credit at >= 12 months', () => {
    expect(trackRecordMultiplier(365)).toBeCloseTo(1, 10);
    expect(trackRecordMultiplier(800)).toBeCloseTo(1, 10);   // clamped
  });
  it('linear in months below a year', () => {
    expect(trackRecordMultiplier(30.4)).toBeCloseTo(1 / 12, 2);   // ~1 month
    expect(trackRecordMultiplier(182.5)).toBeCloseTo(0.5, 2);     // ~6 months
  });
  it('0 for no data', () => { expect(trackRecordMultiplier(0)).toBe(0); });
});
```

**Step 2 — Run, expect fail.**

**Step 3 — Implement** `track-record.ts`:
```ts
const DAYS_PER_MONTH = 365 / 12;
/** Linear track-record weight: full credit at 12 months of observed history,
 *  ~1/12 at one month, 0 at zero. Applied to Sharpe & Sortino only. The shape
 *  may move toward sqrt-scaled after calibration (Phase 2). */
export function trackRecordMultiplier(daysOfData: number): number {
  if (!Number.isFinite(daysOfData) || daysOfData <= 0) return 0;
  return Math.min(daysOfData / DAYS_PER_MONTH / 12, 1);
}
```

**Step 4 — Run, expect pass.**

**Step 5 — Commit:** `git commit -am "feat(scoring): trackRecordMultiplier (linear, 12mo full credit)"`

---

### Task 6: Normalization curves (`curves.ts`)

**Background:** Each raw metric maps to 0..100 via a monotonic piecewise-linear curve defined by `[input, score]` knots. Values below the first knot clamp to its score; above the last, clamp to that score (so the implausible Sharpe>5 region is *capped*, not rewarded). Curve constants are PROVISIONAL — Phase 2 replaces them with calibrated values.

**Files:**
- Create: `packages/scoring/src/curves.ts`
- Test: `packages/scoring/src/curves.test.ts`
- Modify: `packages/scoring/src/index.ts`

**Step 1 — Failing test** (`curves.test.ts`):
```ts
import { applyCurve, METRIC_CURVES, scoreMetric } from './curves.js';

describe('applyCurve', () => {
  const knots: Array<[number, number]> = [[0, 0], [1, 50], [2, 80], [3, 92]];
  it('hits the knots', () => {
    expect(applyCurve(knots, 1)).toBe(50);
    expect(applyCurve(knots, 2)).toBe(80);
  });
  it('interpolates between knots', () => { expect(applyCurve(knots, 1.5)).toBeCloseTo(65, 6); });
  it('clamps below first and above last', () => {
    expect(applyCurve(knots, -5)).toBe(0);
    expect(applyCurve(knots, 99)).toBe(92);
  });
});

describe('scoreMetric', () => {
  it('returns null for a null/NaN metric value', () => {
    expect(scoreMetric('sharpe', null)).toBeNull();
    expect(scoreMetric('sharpe', NaN)).toBeNull();
  });
  it('inverts max-drawdown (smaller dd => higher score)', () => {
    expect(scoreMetric('maxDrawdownPct', 0.05)!).toBeGreaterThan(scoreMetric('maxDrawdownPct', 0.4)!);
  });
  it('every basket metric has a curve', () => {
    for (const k of ['sharpe','sortino','calmar','psr','dsr','profitFactor','expectancy','maxDrawdownPct','recoveryTimeDays','monthlyConsistency'] as const) {
      expect(METRIC_CURVES[k]).toBeDefined();
    }
  });
});
```

**Step 2 — Run, expect fail.**

**Step 3 — Implement** `curves.ts`:
```ts
export type MetricKey =
  | 'sharpe' | 'sortino' | 'calmar' | 'psr' | 'dsr'
  | 'profitFactor' | 'expectancy' | 'maxDrawdownPct'
  | 'recoveryTimeDays' | 'monthlyConsistency';

type Knot = [input: number, score: number];

/** Piecewise-linear, clamped at both ends. Knots must be sorted by input asc. */
export function applyCurve(knots: Knot[], x: number): number {
  if (knots.length === 0) return 0;
  if (x <= knots[0]![0]) return knots[0]![1];
  if (x >= knots[knots.length - 1]![0]) return knots[knots.length - 1]![1];
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1]!, [x1, y1] = knots[i]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return knots[knots.length - 1]![1];
}

// PROVISIONAL — calibrate (Phase 2). These are eyeballed starting points.
// `sharpe`/`sortino` curves are in DAILY-Sharpe units AFTER the track-record
// multiplier is applied (so ~0.05 weak, ~0.15 good, ~0.30 elite).
export const METRIC_CURVES: Record<MetricKey, Knot[]> = {
  sharpe:            [[-0.05, 0], [0, 20], [0.05, 45], [0.10, 65], [0.20, 85], [0.35, 95], [0.6, 100]],
  sortino:           [[-0.05, 0], [0, 20], [0.07, 45], [0.14, 65], [0.28, 85], [0.5, 95], [0.9, 100]],
  calmar:            [[0, 0], [1, 40], [3, 65], [6, 82], [12, 93], [25, 100]],
  psr:               [[0, 0], [0.5, 30], [0.75, 55], [0.9, 75], [0.97, 90], [0.99, 100]],
  dsr:               [[0, 0], [0.3, 35], [0.6, 60], [0.8, 80], [0.95, 100]],
  profitFactor:      [[0.8, 0], [1, 25], [1.25, 50], [1.5, 70], [2, 85], [3, 95], [5, 100]],
  expectancy:        [[0, 30], [1, 55], [10, 75], [100, 90], [1000, 100]], // USD/trade; recalibrate by size cohort
  maxDrawdownPct:    [[0, 100], [0.1, 88], [0.2, 70], [0.3, 50], [0.5, 25], [0.8, 5], [1, 0]], // inverted
  recoveryTimeDays:  [[0, 100], [3, 90], [7, 75], [14, 55], [30, 30], [90, 5], [365, 0]],      // inverted
  monthlyConsistency:[[0, 0], [0.5, 30], [0.7, 55], [0.85, 78], [0.95, 92], [1, 100]],
};

/** Map a raw metric value to 0..100. null/NaN/Infinity => null (not in the basket). */
export function scoreMetric(key: MetricKey, raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  return applyCurve(METRIC_CURVES[key], raw);
}
```

**Step 4 — Run, expect pass.**

**Step 5 — Commit:** `git add packages/scoring/src/curves.ts packages/scoring/src/curves.test.ts packages/scoring/src/index.ts && git commit -m "feat(scoring): metric normalization curves (provisional)"`

---

### Task 7: `medianComposite` + confidence cap

**Background:** Take the up-to-10 metric raw values, normalize each via `scoreMetric`, drop the nulls, take the median (even count → mean of the two middle), then multiply by the confidence factor `min(activeDays/90, 1)`. Also return the per-metric breakdown and a `provisional` flag (`activeDays < 90`).

**Files:**
- Rewrite: `packages/scoring/src/composite.ts` (keep the old `computeComposite`/`computeDecayFlag` exports for now — Phase 5 removes them — but add the new API alongside).
- Test: `packages/scoring/src/composite.test.ts` (add a new `describe('medianComposite')` block; leave existing tests).
- Modify: `packages/scoring/src/index.ts` (already exports `./composite.js`).

**Step 1 — Failing test** (append to `composite.test.ts`):
```ts
import { medianComposite } from './composite.js';

const fullBasket = {
  sharpe: 0.20, sortino: 0.28, calmar: 6, psr: 0.97, dsr: 0.8,
  profitFactor: 2, expectancy: 50, maxDrawdownPct: 0.1, recoveryTimeDays: 7, monthlyConsistency: 0.9,
};

describe('medianComposite', () => {
  it('strong basket with long history => high score, not provisional', () => {
    const r = medianComposite({ metrics: fullBasket, activeDays: 400 });
    expect(r.score).toBeGreaterThan(75);
    expect(r.provisional).toBe(false);
    expect(r.breakdown).toHaveLength(10);
  });
  it('confidence cap shrinks the score for thin history & flags provisional', () => {
    const long  = medianComposite({ metrics: fullBasket, activeDays: 400 }).score;
    const short = medianComposite({ metrics: fullBasket, activeDays: 30 });
    expect(short.score).toBeCloseTo(long * (30 / 90), 6);
    expect(short.provisional).toBe(true);
  });
  it('an outlier metric does not blow up the median', () => {
    const withGarbage = medianComposite({ metrics: { ...fullBasket, sharpe: -1 }, activeDays: 400 }).score;
    const clean       = medianComposite({ metrics: fullBasket, activeDays: 400 }).score;
    expect(Math.abs(withGarbage - clean)).toBeLessThan(8); // median is robust
  });
  it('nulls are dropped from the basket', () => {
    const r = medianComposite({ metrics: { ...fullBasket, dsr: null }, activeDays: 400 });
    expect(r.breakdown.filter((b) => b.score !== null)).toHaveLength(9);
  });
  it('empty/all-null basket => score 0', () => {
    expect(medianComposite({ metrics: {}, activeDays: 400 }).score).toBe(0);
  });
});
```

**Step 2 — Run, expect fail.**

**Step 3 — Implement** in `composite.ts` (add, don't delete existing):
```ts
import { type MetricKey, scoreMetric } from './curves.js';

export interface MedianCompositeInput {
  metrics: Partial<Record<MetricKey, number | null>>;
  activeDays: number;
}
export interface MedianCompositeResult {
  score: number;                 // 0..100 after confidence cap
  rawScore: number;              // median before confidence cap
  confidence: number;            // min(activeDays/90, 1)
  provisional: boolean;          // activeDays < 90
  breakdown: Array<{ key: MetricKey; raw: number | null; score: number | null }>;
}

const BASKET: MetricKey[] = [
  'sharpe','sortino','calmar','psr','dsr',
  'profitFactor','expectancy','maxDrawdownPct','recoveryTimeDays','monthlyConsistency',
];

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function medianComposite(input: MedianCompositeInput): MedianCompositeResult {
  const breakdown = BASKET.map((key) => {
    const raw = input.metrics[key] ?? null;
    return { key, raw, score: scoreMetric(key, raw) };
  });
  const present = breakdown.map((b) => b.score).filter((s): s is number => s !== null);
  const rawScore = median(present);
  const confidence = Math.min(Math.max(input.activeDays, 0) / 90, 1);
  return {
    score: Math.round(rawScore * confidence),
    rawScore,
    confidence,
    provisional: input.activeDays < 90,
    breakdown,
  };
}
```

**Step 4 — Run, expect pass** (`pnpm --filter @copytrade/scoring test` — all old + new tests green).

**Step 5 — Commit:** `git commit -am "feat(scoring): medianComposite with confidence cap + breakdown"`

---

### Task 8: Export surface + a tiny end-to-end test from a return series

**Files:**
- Modify: `packages/scoring/src/index.ts` — ensure `curves.js`, `consistency.js`, `track-record.js` are exported.
- Test: `packages/scoring/src/composite.test.ts` — one integration-ish test that goes returns → metrics → medianComposite.

**Step 1 — Failing test:**
```ts
import { buildDailySeries, toDailyReturns } from './returns.js';
import { dailySharpe } from './metrics.js';
import { annualizedSortino, calmar, maxDrawdownPct, recoveryTimeDays, profitFactor, expectancy } from './metrics.js';
import { monthlyConsistency } from './consistency.js';
import { trackRecordMultiplier } from './track-record.js';

it('end-to-end: a tidy winning series scores well and is not provisional', () => {
  // 200 days, small steady gains + occasional dip
  const fills = Array.from({ length: 200 }, (_, i) => ({
    blockTimeMs: Date.UTC(2024, 0, 1) + i * 86_400_000,
    closedPnl: (i % 9 === 0 ? -20 : 12).toString(), fee: '0.5', sz: '1', px: '100',
  }));
  const series = buildDailySeries({ fills, fundings: [], ledger: [] });
  const returns = toDailyReturns(series, 10_000);
  const days = series.activeDays;
  const mult = trackRecordMultiplier(days);
  const r = medianComposite({
    metrics: {
      sharpe: (dailySharpe(returns) ?? 0) * mult,
      sortino: ((annualizedSortino(returns) ?? 0) / Math.sqrt(365)) * mult,
      calmar: calmar(returns),
      psr: null, dsr: null, // computed in the worker with population stats
      profitFactor: profitFactor(returns),
      expectancy: expectancy(series.daily.map((d) => d.pnl.toNumber())),
      maxDrawdownPct: maxDrawdownPct(returns),
      recoveryTimeDays: recoveryTimeDays(returns),
      monthlyConsistency: monthlyConsistency(series.daily.map((d) => ({ dayKey: d.dayKey, pnl: d.pnl }))),
    },
    activeDays: days,
  });
  expect(r.provisional).toBe(false);
  expect(r.score).toBeGreaterThan(50);
});
```

**Step 2–4 — Run; adjust the export list / assertions until green.** (If `score` lands surprisingly low, that's a *signal the provisional curves need calibration* — note it, don't force-fit the curves to one synthetic series.)

**Step 5 — Commit:** `git commit -am "test(scoring): end-to-end returns->composite smoke test; finalise exports"`

---

### Task 9: Phase-1 wrap

- Run `pnpm --filter @copytrade/scoring test` — all green.
- Run `pnpm --filter @copytrade/scoring exec tsc --noEmit` (or `pnpm -r check` scoped) — no type errors.
- Update `docs/plans/2026-05-11-swash-scoring-redesign-design.md` §1.5 with whatever you learned about the DSR fix (did daily-units alone fix it, or did `adjustedBenchmarkSharpe` need a change?).
- Commit any doc updates.
- Use `superpowers:requesting-code-review` on the Phase-1 diff before moving on.

---

## Phase 2 — Curve calibration tool

### Task 10: `calibrate-curves.ts` script

**Files:**
- Create: `apps/worker/src/scripts/calibrate-curves.ts`
- Modify: `apps/worker/package.json` (add a `"calibrate": "tsx src/scripts/calibrate-curves.ts"` script) — confirm `tsx` is available (it's a root devDep).

**What it does (runbook, not TDD — this is exploratory):**
1. Read a wallet list: either `--from-db` (pull all `scored` + `ingested` addresses from `wallets`) or `--from-leaderboard` (call `hl().leaderboard(...)` for each window and dedupe). Cap with `--limit N` (default 300). Respect the existing HL weight budget / cache (`packages/hl-client` already caches to `.cache/hl`).
2. For each address: reuse the worker's existing pipeline pieces (`collectMasterAndAgents` logic, fetch `fills`/`fundings`/`ledgerUpdates` from the DB — they're already ingested for `scored`/`ingested` wallets — *or* call HL directly if `--fetch`). Build `buildDailySeries` → `toDailyReturns` → all 10 raw metrics (using `dailySharpe`, the `/√365` Sortino, etc., **before** curve normalization, **before** the track-record multiplier — also record `daysOfData` separately).
3. Print, for each metric: count, min, p10, p25, median, p75, p90, p99, max — plus the same for the track-record-multiplied Sharpe/Sortino, and for the final `medianComposite` under the *current provisional* curves.
4. Dump a CSV (`--out calibration-<date>.csv`) with one row per wallet × all raw metrics + days + provisional-composite, for offline inspection.

**Then (human/Claude decision step, not code):**
- Eyeball the distributions. Adjust `METRIC_CURVES` in `packages/scoring/src/curves.ts` so that: the median scored wallet lands ~50–60 on each metric, the curated bar (composite ≥ 70) actually selects the genuinely-good tail (not 90% of the leaderboard, not 3 wallets), and nothing saturates at 100 for a broad band. Decide linear-vs-√ for `trackRecordMultiplier`. Decide DSR keep-or-drop based on whether it produces a real spread (Task 3 finding + the distribution here).
- Update the `// PROVISIONAL` comments → `// CALIBRATED <date> from N=<count> wallets`.
- Re-run `pnpm --filter @copytrade/scoring test` (curve-knot tests may need their expected numbers updated — that's fine, they pin *shape* not exact values; keep at least the clamp/monotonicity/inversion assertions).
- Commit: curves + the script + a short `docs/plans/2026-05-11-curve-calibration-notes.md` recording the dataset, the chosen knots, and the rationale.

---

## Phase 3+ — Pipeline reorientation (outline only; gets its own plan after Phase 1–2)

These depend on the final score shape, so they're sketched, not bite-sized yet:

- **Phase 3 — DB migration** (`packages/db`): `scores` gains the 10 normalized sub-scores + `raw_composite`, `confidence`, `provisional`; `wallets` gains `curated boolean default false`, `curated_since timestamptz`, `market_maker boolean default false`. New `score_requests` table (`id`, `address`, `requested_by`, `status` enum `queued|running|done|failed`, `enqueued_at`, `finished_at`, `error`). Generate via `pnpm db:generate`, review the SQL, commit.
- **Phase 4 — `services/eligibility.ts`** (`apps/worker`): the shared gate — `accountValue ≥ 10_000`, `volume ≥ 100_000`, `firstSeen ≥ 90d ago`, `activeDays ≥ 30`, `roundTrips ≥ N` (N from calibration), `capitalBaseKnown` (has ≥1 deposit ledger row, or other heuristic), and `isMarketMaker` (maker share > ~0.95 && avgHold < ~60s && |longShortRatio−0.5| < ~0.1 && fills > ~1000 → tag, exclude from hook). Pure function over already-fetched rows; unit-tested.
- **Phase 5 — worker jobs:** new `jobs/leaderboard-sweep.ts` (pull HL leaderboard all windows → eligibility-gate newcomers → ingest+score eligible → re-score curated set → rebuild `wallets.curated` by the ≥70 bar with ~65 hysteresis); new `jobs/score-requests.ts` (drain `score_requests`, own rate budget, 24h cache TTL, auto-promote on ≥70 + eligibility). **Rewire** `jobs/score.ts`: it now consumes `medianComposite` + per-population PSR/DSR computed from **daily** Sharpes (fix the two-pass code), writes the new `scores` columns, and is invoked *only* for the curated set (or one `--address`). Remove `computeComposite`/`computeDecayFlag` and their tests once nothing imports them. Update `cli.ts` + the cron in `index.ts`.
- **Phase 6 — web** (`apps/web`): leaderboard reads `wallets.curated`; add Sharpe/Sortino and 7d-ROI sort lenses + group-tag filters; trader page shows the per-metric breakdown + provisional badge + "top X% of curated" garnish; "Score this wallet" CTA → POST creates a `score_request`, page polls until `done`. Rewrite `/methodology` to this model; **delete** the "net PnL / deposits" section (keep the computation). Global copy sweep "Swish" → "Swash" (also `static/swish.svg` → already deleted in the main worktree — reconcile).
- **Phase 7 — cleanup:** retire bulk discovery deep-ingest (downgrade to findability-only row upserts), `finishing-a-development-branch` skill, open the PR.

---

## Notes for the implementer

- The repo was recently renamed `swish` → `swash`; the main working tree is `/Users/ege/swash` and has uncommitted UI edits — **don't** pull those into this worktree, work only on the `scoring-redesign` branch.
- `apps/web` has uncommitted changes upstream; avoid touching `apps/web` until Phase 6 to dodge conflicts.
- `packages/hl-client` has a `test` script but no test files — `pnpm -r test` will report it as a failure. That's pre-existing; scope test runs to `--filter @copytrade/scoring` while working in Phase 1.
- Existing `score.ts` uses `simple-statistics`' `sampleVariance`/`mean` on the **annualized** Sharpe population — that's part of the DSR bug; the Phase-5 rewire switches it to daily Sharpes.
