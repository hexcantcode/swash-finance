# Curve calibration notes — 2026-05-11

Re-fit of `packages/scoring/src/curves.ts` (`METRIC_CURVES`) from real Hyperliquid
wallet data, replacing the PROVISIONAL eyeballed knots. Phase 1, Task 7 of the
data-sources / scoring-cleanup plan.

## Dataset

- **Source:** `--source=db` (Neon, the `wallets` table candidate pool), `--limit=400`.
- **N = 235 wallets** scored (270 candidates loaded; ~35 produced no usable series).
- **Date:** 2026-05-11 (one snapshot — re-run `apps/worker` `calibrate-curves.ts` to refresh).
- Each wallet is replayed through the J-1 scoring path: master+agents fills → daily
  series → daily returns → metrics. `sharpe`/`sortino` curve inputs are the
  **track-record-multiplied daily** values (`sharpeScaled` / `sortinoScaled`), NOT the
  raw daily Sharpe — that's the column the curve actually sees, and the single biggest
  fix vs the provisional knots (which were placed at raw-daily values ~10× too large).

## Observed quantile table (N = 235)

| quantity            |  n  |     min |     p10 |     p25 |     p50 |     p75 |      p90 |       p99 |       max |
|---------------------|-----|--------:|--------:|--------:|--------:|--------:|---------:|----------:|----------:|
| sharpe (raw daily)  | 214 |  -8.008 | -0.6512 | -0.2830 |  0.0611 |  0.1969 |   0.4501 |    0.7905 |     1.279 |
| sortino (raw daily) | 210 | -0.8094 | -0.5341 | -0.3112 |  0.0675 |   1.709 |   27.013 |   753.248 |   975.981 |
| psr                 | 210 |  0.0000 |  0.0004 |  0.0575 |  0.6822 |  0.9707 |   0.9998 |    1.000  |    1.000  |
| profitFactor        | 230 |  0.0000 |  0.0054 |  0.2695 |  0.9816 |   2.720 |   37.654 |     1976  |     3589  |
| maxDrawdownPct      | 228 |  0.0000 |  0.0036 |  0.0216 |  0.2194 |  0.9900 |   0.9986 |    1.0000 |    1.0000 |
| recoveryTimeDays    | 118 |   1.000 |   2.000 |   3.000 |   8.000 |  14.000 |   22.600 |    51.280 |    63.000 |
| monthlyConsistency  | 235 |  0.0000 |  0.0000 |  0.0000 |  0.3333 |  0.7500 |    1.000 |     1.000 |     1.000 |
| **sharpeScaled**    | 214 |  -1.969 | -0.1114 | -0.0462 |  0.0065 |  0.0353 |   0.0796 |    0.1916 |    0.3013 |
| **sortinoScaled**   | 210 | -0.1782 | -0.1065 | -0.0458 |  0.0117 |  0.3511 |    5.754 |   81.638  |   203.190 |
| activeDays          | 235 |   1.000 |   7.000 |  22.000 |  57.000 |  81.000 |   88.000 |    90.000 |    90.000 |
| daysOfData          | 235 |  0.1040 |  33.525 |  63.056 |  85.917 |  89.348 |   89.875 |    89.917 |    89.917 |

Notes on the population: this is essentially "every tracked HL wallet", not a curated
set — roughly half are net losers (`profitFactor` p50 ≈ 0.98, `monthlyConsistency`
p25 = 0, `maxDrawdownPct` p75 = 0.99 i.e. ≥25% blew up most of the account). The
~90-day data window means `daysOfData` is right-bounded near 90; `recoveryTimeDays`
only exists for the ~118 wallets that had a drawdown-then-recovery episode.

## Chosen knots & rationale

The 7-metric basket is the **median of normalized sub-scores**. Each curve is shaped so
the **sample-median wallet lands ~57** on that metric, the lower bulk gets discriminating
low scores (a losing record is bad, not worthless — floors ~12–26), and ~p95+ → 90+.
Heavy-tailed metrics (`sortino`, `profitFactor`) are clamped near their sample p90 (past
the top knot → 100). `maxDrawdownPct` and `recoveryTimeDays` stay **inverted** (monotone
decreasing — small raw → high score). Knot inputs are strictly increasing; every curve is
monotone in its intended direction (`curves.test.ts` asserts both).

- **sharpe** `[[-2,12],[-0.11,22],[-0.046,32],[0,40],[0.0065,57],[0.018,64],[0.035,70],[0.055,76],[0.08,83],[0.19,94],[0.3,100]]`
  — input = `sharpeScaled`. Knots at p10/p25/p50/p75/p90/p99 of that column; 0 → 40, deep-negative → 12.
- **sortino** `[[-1,12],[-0.106,22],[-0.046,32],[0,40],[0.012,57],[0.05,63],[0.35,69],[1.5,76],[5.7,84],[20,94],[81,100]]`
  — input = `sortinoScaled`; same low-end shape as sharpe; clamp ~p90 (5.7) → 84, ~p99 (81) → 100.
- **psr** `[[0,12],[0.0004,20],[0.057,37],[0.3,47],[0.68,57],[0.85,64],[0.97,73],[0.9998,88],[1,100]]`
  — discriminates low/mid then saturates near 1; knots at p10/p25/p50/p75/p90/p99.
- **profitFactor** `[[0,14],[0.005,22],[0.27,37],[0.6,47],[0.98,57],[1.5,64],[2.72,70],[8,80],[37.6,90],[120,96],[1976,100]]`
  — input = per-trade pnl ratio. Fat tail clamped: ~p90 (37.6) → 90, ~p99 (1976) → 100; < 1 (net loser) → < 57.
- **maxDrawdownPct** (INVERTED) `[[0,100],[0.004,93],[0.022,84],[0.05,76],[0.1,69],[0.22,57],[0.4,46],[0.7,36],[0.99,26],[1,22]]`
  — knots at p10/p25/p50 of raw maxDD (inverted); floor ~22 (a blown account is bad, not −∞-bad — ≥25% sit above 0.99).
- **recoveryTimeDays** (INVERTED) `[[1,93],[2,86],[3,79],[5,69],[8,57],[14,46],[22.6,36],[40,26],[63,20]]`
  — knots at p10/p25/p50/p75/p90 of raw days; sample median (8d) → 57; > a month → low-20s.
- **monthlyConsistency** `[[0,26],[0.1,36],[0.2,44],[0.3333,57],[0.5,65],[0.75,75],[0.9,87],[1,100]]`
  — ≥25% of the sample is at exactly 0 → floor ~26, not 0; p50 (0.333) → 57; p90 (1.0) → 100.

## Composite distribution: before vs after

`medianComposite().score` over the 235 wallets (the score includes the
`min(daysOfData/90, 1)` confidence cap):

| stat  | before (provisional / 8-metric eyeball) | after (calibrated / 7-metric) |
|-------|-----------------------------------------|-------------------------------|
| p10   |  9.4  | 17.0 |
| p25   | 17.0  | 25.0 |
| p50   | 28.0  | 36.0 |
| p75   | 56.0  | 63.5 |
| p90   | 75.0  | 74.0 |
| p99   | 98.0  | 96.7 |
| max   | 100   | 99   |
| **>= 70** | 30 / 235 (12.8%) | **35 / 235 (14.9%)** |

The **raw** (pre-confidence-cap) composite median is ≈ 53.5 — squarely in the
"sane: 40–65" band. The **capped** median (36) sits just below it: ~32% of the sample
has `daysOfData < ~72d` (p25 = 63d → ×0.70), and a chunk of the high-raw-score wallets
happen to be short-history ones that the cap knocks down. That's a property of the
`medianComposite` confidence cap on this population, not of the curves — no curve shape
fixes it without flattening discrimination in the bottom half. `>= 70` at 14.9% is a
small minority as intended. Not pinned at 0 or 100 for any broad band.

## Expectancy decision: **DROPPED from the basket**

`expectancy` (raw USD per trade) is gone — `MetricKey`, `METRIC_CURVES`, `composite.ts`'s
`BASKET`, `score.ts`'s metrics object, `calibrate-curves.ts`'s quantity list + CSV, and
the affected tests were all updated (the `expectancy` metric *function* in `metrics.ts` is
untouched — `scores.expectancy` is still computed as a display column). Rationale: a prior
235-wallet run put it at p10 ≈ −84, p50 ≈ 0.004, p90 ≈ 158, range ≈ −1719…1418 — mass
split almost 50/50 around zero, so even a clamped piecewise curve can't discriminate at
the median; and the value is scale-dependent (a $1M account and a $1k account with the
same skill get wildly different expectancies). Per the runbook this is the explicit
"drop" case. Dropping it also makes the basket odd (7) → a true median. If we want an
expectancy-like signal back, the candidate is a **per-trade RETURN** expectancy
(unitless) — that's a separate task (changing the metric formula).

## Round-trip-trade floor recommendation for eligibility

The calibration CSV does **not** carry a fill / round-trip-trade count — only `daysOfData`
(calendar span) and `activeDays` (distinct days with activity). So a precise `N` needs a
**follow-up query** against the fills/positions tables (count of closed round-trip trades
per wallet, then look at the distribution). Interim guidance from what we do have:
`activeDays` p10 = 7, p25 = 22, p50 = 57 — wallets below ~15–20 active days have records
too thin to trust, so an `activeDays >= 20` proxy floor (plus the existing `daysOfData`
confidence cap) is a reasonable stopgap until the trade-count query is run. Recommend
landing the real round-trip-trade floor in the eligibility step once that query exists;
~30–50 closed round-trips is the usual rule-of-thumb starting point for Sharpe/PSR to
mean anything, but confirm against the actual distribution before fixing it.
