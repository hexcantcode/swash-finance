# Swash — Scoring Redesign & Curated-Hook Model

**Date:** 2026-05-11
**Status:** Design agreed; pending implementation.
**Supersedes:** the additive-binary composite rubric ("rubric v1.0") in `packages/scoring/src/composite.ts` and the bulk `runScoreRecompute` model in `apps/worker/src/jobs/score.ts`.

---

## 0. Why

Swash is a discovery platform for on-chain traders. The product model:

- **Every HL wallet can get a score, but scoring is on-demand** for arbitrary wallets — we do not pre-score the whole chain. Wallets are *findable* (search by address); the score is computed/refreshed when requested.
- **The hook = a curated "best traders" list** on the front page, pre-scored, seeded for v1 from **HL's official leaderboard**. (Our own WS discovery is deferred; a strong discovery tool is on the roadmap, not v1.)
- **Social distribution**: anyone can surface their own wallet and make it copyable for their circle. The curated best-of is top-of-funnel; "score my wallet / my friend's wallet" is the spread mechanism.
- **The curated list is "anyone who earns it"** — not "whoever HL surfaced." A wallet scored on-demand that clears the bar gets auto-promoted.

The current code points the wrong way: it bulk-discovers thousands of wallets, bulk-scores every active master daily, and the composite saturates (everyone 90–100, DSR contributes 0 for everyone, some "100" wallets have a 3% win rate). This redesign fixes the scoring math and reorients the pipeline to *curated hook + on-demand*.

---

## 1. Scoring model

**One global composite per trader, `0–100`** — shown everywhere, the same number regardless of which "group" lens you view the trader through. Groups (tags) are filters/sorts over the same population; they do not change the score.

### 1.1 Composite = median of a 10-metric basket

The composite is the **median** of 10 normalized metric scores (robust to an outlier metric; with 10 metrics the median is the mean of the two middle values).

| # | Metric | Notes |
|---|--------|-------|
| 1 | Annualized Sharpe | × track-record multiplier (§1.3) |
| 2 | Annualized Sortino | × track-record multiplier (§1.3) |
| 3 | Calmar | return ÷ max drawdown |
| 4 | PSR (probabilistic Sharpe) | sample-quality discount (Bailey & López de Prado 2012) |
| 5 | DSR (deflated Sharpe) | **blocked on fixing the always-zero bug** — see §1.5. If unfixable cleanly, drop to a 9-metric basket. |
| 6 | Profit factor | gross win ÷ gross loss |
| 7 | Expectancy | per-trade; scaled by trade count for sample confidence |
| 8 | Max drawdown | inverted (smaller = higher score) |
| 9 | Recovery time from drawdown | inverted |
| 10 | Monthly consistency | % profitable months / smoothness of the monthly return series — copy-traders weight "doesn't blow up" over "spiky 10×" |

### 1.2 Normalization — absolute curves, not percentiles

Each metric maps through a **hand-calibrated absolute curve** to `0–100` (e.g. Sharpe: 1.0→50, 2.0→80, 3.0→92, with the implausible >5 region capped/penalized; profit factor 1.5→70; max-DD 15%→80, 40%→30). Then take the median.

- Works with **zero population** — an on-demand wallet gets a real number instantly, no reference set needed.
- Stable over time — "70" means the same thing forever, which is what makes the curated-list bar (§2.1) defensible.
- **Percentile within the curated population** ("top X% of curated traders") is shown as *leaderboard garnish* — it is **not** part of the score.

Curves live in a dedicated `packages/scoring/src/curves.ts`. They are **calibrated against real HL wallet histories** (§4), not guessed.

### 1.3 Track-record multiplier (Sharpe & Sortino only)

Don't extrapolate a hot month into a fake year. The annualization multiplier *is* the track-record weight:

```
factor = base × min(months_of_data / 12, 1)
```

Linear; full credit at 12 months, ~1/12 at one month. (Alternative √-scaled form `base × √(min(days/365, 1))` is less aggressive — we start linear because over-crediting a 1-month wonder is the dangerous error for a copy-trading hook, then dial toward √ if real data shows it nukes legitimately-good 2–3-month traders.) `base` is calibrated in §4.

Note: annualization is a constant — it does not change *ranking* (ranking by annualized Sharpe ≡ ranking by raw daily Sharpe). The track-record multiplier deliberately *breaks* that, by giving longer real histories more credit.

### 1.4 Confidence cap (final composite)

```
composite ×= min(active_days / 90, 1)
```

Anything under ~90 active days is also labelled **"provisional"** in the UI. Belt-and-suspenders with §1.3: thin history shrinks Sharpe/Sortino *and* caps the composite. Curated-list eligibility (§2.1) requires ≥90 days anyway, so provisional scores only ever appear on on-demand wallets.

### 1.5 DSR fix

DSR is currently `0.0000` for every scored wallet — the adjusted benchmark Sharpe (via `adjustedBenchmarkSharpe(trialCount, srVariance)`) is being driven so high that nobody clears it, so PSR(SR*) ≈ 0 everywhere. Before DSR can stay in the basket: investigate the `trialCount` / `srVariance` inputs from the worker's two-pass population stats, confirm the variance is annualized consistently with the observed Sharpe, and sanity-check against a known example. If we can't make it produce a sensible spread, **drop it** — a degenerate metric in the basket is worse than nine good ones.

### 1.6 Display

- Internally rank on the **raw daily ratios** (the only thing that matters for the score).
- On screen, show a **windowed Sharpe/Sortino** — "90-day Sharpe", "since-inception Sharpe" — so nothing reads as a yearly forecast. The annualized figure is available as a tooltip for the finance crowd.
- Trader profile shows the **per-metric breakdown** (the 10 sub-scores) + the composite + the provisional badge if applicable + the "top X% of curated" garnish.

---

## 2. Curated list, daily loop, on-demand

### 2.1 Curated "best traders" list — the hook

**Membership = quality bar:** `composite ≥ 70` ⇒ on the list. No fixed N — traders that good are rare, so the list stays naturally tight; it grows/shrinks with reality. Small hysteresis (drop only below ~65) so wallets don't flap at the boundary.

**Hard pre-conditions** (the eligibility gate — cheap, applied before/around scoring; shared by the daily sweep and the on-demand path):

- `account_value ≥ $10,000`
- `total_volume ≥ $100,000`
- **Track-record floor**: first seen ≥ 90 days ago AND ≥ 30 active trading days AND ≥ N round-trip trades (N TBD in §4 — guard against "2000 fills in a day" bots).
- **Data quality**: we can reconstruct a capital base (deposit history visible or otherwise inferable). If not, the wallet shows "insufficient data", not a fabricated ROI/score.
- **Not a market-maker / grid bot**: maker share ≈ 100%, near-zero hold time, near-symmetric long/short, thousands of tiny fills ⇒ `market maker` tag, **never** appears in the hook (but remains scoreable on-demand).

**Presentation:** default sort = composite. Alternate lenses over the same set:
- **Sharpe / Sortino** view (the "global" risk-adjusted yardstick).
- **7-day ROI** view ("hot right now").
Group tags (cadence / risk / size / asset / archetype) are filters over this set.

### 2.2 Daily cron (`leaderboard-sweep`)

1. Re-pull HL's official leaderboard, all windows (day / week / month / allTime).
2. Any wallet not already tracked → run the eligibility gate (§2.1); drop MMs.
3. Eligible newcomers → ingest 90d history (+ approved agents, rolled up to the master) → score.
4. Re-score every wallet already in the curated set (metrics drift; decay/heat flag updates).
5. Rebuild the public list (apply the ≥70 bar + hysteresis).

### 2.3 On-demand scoring (the CTA path)

- Any wallet, requested by a user → enqueued in its **own queue** with its **own rate budget** against HL (so a viral share doesn't starve the daily sweep).
- If the wallet was scored within the last **24h** → serve cached; else ingest + (re)score.
- Result shows the composite + provisional flag if history is thin; the wallet becomes *findable/shareable* immediately.
- **Auto-promotion**: if the on-demand result clears `composite ≥ 70` **and** passes the full eligibility gate, the wallet is promoted into the curated list and joins the daily re-score set. It falls back off if it later drops below ~65.

---

## 3. Codebase changes

**`packages/scoring`**
- New `composite.ts`: `medianComposite(metrics)` over the 10-curve basket; remove the additive `computeComposite` rubric.
- New `curves.ts`: the calibrated absolute curves (one per metric) + the percentile-garnish helper.
- `metrics.ts`: add the track-record multiplier to Sharpe/Sortino.
- `dsr.ts`: fix the always-zero behavior or remove (§1.5).
- Confidence-cap helper for the final composite.
- Updated + new tests; calibration fixtures from §4.

**`packages/db`** (migration)
- `scores`: per-metric normalized sub-scores (for the breakdown UI), `provisional` flag, `data_sufficiency` factor.
- `wallets`: `curated` (bool), `curated_since` (timestamp), keep `market_maker`/tag handling.
- New `score_requests` table for the on-demand queue (address, requested_by, status, enqueued_at, …).

**`apps/worker`**
- `jobs/leaderboard-sweep.ts` — the daily cron (§2.2).
- `jobs/score-requests.ts` — drain the on-demand queue, own rate budget.
- `services/eligibility.ts` — the shared gate (§2.1): $10k/$100k/track-record/data-quality/MM-detection.
- Retire/repurpose `runScoreRecompute` → "re-score the curated set" only, not "score every discovered wallet". The 30s `refresh-queue` cron and bulk discovery stay but are downgraded to *findability only* (ingest wallet rows, not deep history) until the discovery tool is built.
- CLI: keep `score --address` as the manual on-demand trigger; add `leaderboard-sweep`.

**`apps/web`**
- Leaderboard page reads `wallets.curated`; add the Sharpe/Sortino and 7d-ROI sort lenses; group-tag filters.
- Trader page: per-metric breakdown + provisional badge + percentile garnish.
- "Score this wallet" CTA → enqueues a `score_request`, polls for the result.
- Rewrite `/methodology` to this model; **remove the "net PnL / deposits" explainer section** (the computation stays — net PnL still subtracts net deposits — just drop the prose).
- Copy sweep: "Swish" → "Swash" everywhere.

---

## 4. Calibration / validation step (blocks everything downstream)

Before any curve, the `base` multiplier, or the round-trip floor `N` is locked: a one-off research script —

1. Pull ~200–500 real HL wallet histories (mix of leaderboard wallets + a random sample) via the existing `hl-client`.
2. Compute the raw distributions of all 10 metrics across them.
3. Fit each absolute curve so that **70 ≈ "genuinely good"** and the top of the range isn't saturated (the current failure mode).
4. Sanity-check the track-record multiplier: does linear `min(months/12, 1)` nuke legitimately-good 2–3-month traders? If so, move toward √-scaled.
5. Pick the round-trip floor `N` from where bot-vs-human separation actually falls.
6. Verify the DSR inputs produce a sensible spread (§1.5); decide keep-or-drop.

Output of this script *is* the calibration. We do not ship guessed curves.

---

## 5. Suggested implementation order

1. **Calibration script + curve fitting** (§4) — unblocks the scoring package.
2. **`packages/scoring` rewrite** — `curves.ts`, `medianComposite`, track-record multiplier, confidence cap, DSR fix/drop; tests green.
3. **DB migration** — `scores` sub-scores/provisional, `wallets.curated`, `score_requests`.
4. **`services/eligibility.ts`** — the shared gate.
5. **`jobs/leaderboard-sweep.ts`** — wire the daily loop; run it for real, populate the curated set.
6. **`jobs/score-requests.ts`** + the web CTA — the on-demand path.
7. **Web** — leaderboard lenses, trader breakdown, methodology rewrite, Swash copy sweep.
8. Retire bulk `runScoreRecompute`; downgrade discovery to findability-only.

---

## 6. Open items / deferred

- **Strong discovery tool** — deferred to a later milestone (not v1).
- **Round-trip floor `N`** — set in §4.
- **DSR keep-or-drop** — decided in §4 / §1.5.
- **Hysteresis band** for curated-list membership — ~65 is a placeholder; revisit with real churn data.
- **Linear vs √ track-record multiplier** — start linear, revisit with real data.
