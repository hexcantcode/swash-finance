# Copyability-aware composite score — design (2026-05-12)

## Problem

The composite score doesn't punish "a shallow account that got lucky" hard
enough. Today's pipeline is:

- `evaluateEligibility(...)` — a **hard pass/fail** gate ($10K account value,
  $100K lifetime volume, ≥90-day track record, ≥30 active days, ≥30 round-trips,
  capital base reconstructable, not-a-market-maker). Used only for the *curated*
  list, not the "Winners" cards.
- `medianComposite({ metrics, daysOfData })` — median of seven normalized
  performance curves (sharpe, sortino, psr, profitFactor, maxDrawdownPct,
  recoveryTimeDays, monthlyConsistency) → 0..100, then `× min(daysOfData/90, 1)`.
- Curated = `eligibility.eligible && composite ≥ 70` (65 hysteresis).

Nothing makes a $12K, 40-trade, 6-week account that 20×'d on max leverage score
*below* a $2M, 3-year, 3×-leverage account when their Sharpe/drawdown happen to
look similar. The eligibility floors are a cliff, not a slope, and the Winners
set ranks "hot this week" with only a light noise filter — so the cards full of
low composites are partly the score *correctly* saying "hot, not actually good",
but the score itself is too blunt.

## The score, plainly

> **score = "how good is the trading" × "how much can you trust & copy it"**

- **quality (0..100)** — unchanged: the median of the seven normalized
  performance curves (median so one fluky metric can't carry them).
- **× copyability `C` (0..1)** — a single multiplier that drags the score down
  for thin records, degen leverage, one-asset cowboys, and brutal drawdowns; `0`
  for obvious bots / corrupt PnL.

A $2M, 3-year, sane-leverage trader with a real Sharpe keeps ~all their score; a
$10K account that 20×'d in a week on max leverage lands near zero no matter how
shiny the ROI. **"Good trader" = score ≥ 70**, which now means real *and*
copyable *and* good in one number.

## Formula

```
composite_score = round( quality × C )

quality = median( normalized metric basket )        # = medianComposite(...).rawScore, unchanged
C       = capital · sample · history · mirror       # all in [0,1]
C       = 0  (hard)  if  looksLikeMarketMaker  OR  capital base not reconstructable
```

### The ramps (`capital`, `sample`, `history`)

These replace the *floor* part of `evaluateEligibility` with slopes. Each is a
piecewise-linear, clamped 0→1 curve (reuse `applyCurve` from `curves.ts`).
Interim knees — **flagged for calibration against real HL data**, same as the
metric curves:

| factor   | input                              | curve (input → factor)                                  | rationale |
|----------|------------------------------------|---------------------------------------------------------|-----------|
| `capital`| `accountValueUsd`                  | $1K→0, $10K→0.5, $50K→0.85, $100K→1.0 (log-ish via knots)| barely-eligible ($10K) caps you near 50; whale ≈ 1.0 |
| `sample` | round-trips (`totalRoundTrips`)    | 0→0, 10→0.25, 30→0.5, 75→0.8, 150→1.0                   | tiny samples ⇒ unreliable metrics |
| `history`| `daysOfData` (first→last event)    | 0→0, 30→0.3, 90→0.6, 180→1.0                            | stretched form of today's `/90` cap |

If an input is `null`/non-finite the factor is treated as `0` for `capital`
(no account value ⇒ can't trust it) and `0` for `history` (no span), and `0` for
`sample` when round-trips is `0`/unknown — i.e. missing data on these is *bad*,
consistent with the old gate failing them.

### `mirror` (the strategy-is-copyable factor)

Starts at `1`, subtract penalties, floor at `0.5` — **except** the leverage
hard-cap, which can take `C` to ~0:

- **leverage** — *the headline term* ("lucky shallow account" ≈ "degen-leverage
  account"). Input: `leader_cache.leverage` — account-level gross leverage
  (total notional ÷ account value) at the last live-WS cache refresh; `null` for
  wallets the WS subscriber doesn't track.
  - `≤ 3×` → no penalty
  - `3×–15×` → ramps to `−0.5`
  - `> ~20×` → **hard: `C → ~0`** ("a follower copying this gets liquidated")
  - `null` (unknown) → **no penalty** — don't punish missing data; v1 limitation.
  - *Follow-up:* there is no historical leverage metric today; this snapshot is a
    proxy. Later: average / p95 leverage over history (needs position
    reconstruction + account-value history, or averaging the leverage samples we
    already capture each WS cache refresh).
- **asset concentration** — `assetConcentration` (already computed in `score.ts`,
  0..1, fraction in the top asset by notional): `≤ 0.5` → none, `1.0` → `−0.2`.
- **max drawdown** — `maxDrawdownPct`: `≤ 0.5` → none, `≥ 0.9` → `−0.2`.

### What the eligibility gate becomes

`evaluateEligibility` shrinks to just the *hard exclusions*: market-maker
pattern, capital base unreconstructable. The numeric floors (account value,
volume, track record, active days, round-trips) move into `C` as the
`capital`/`sample`/`history` ramps. Curated list becomes simply:

```
curated = (C > 0) && composite_score >= 70     # 65 hysteresis to stay
```

i.e. not-a-bot, not-corrupt, and good-once-discounted-for-copyability.

> **Scope note:** for *this pass* we keep `evaluateEligibility` as-is (it still
> works) and just multiply the composite by `C`; the gate-restructuring above is
> a follow-up so the change stays reviewable. The numbers move the same
> direction either way — `C` already discounts thin/levered traders, the gate
> just stops being the thing that *also* does it.

## Display

`copyability` is **recomputed on the fly** for the trader page (no schema change
— `composite_score` stays the one stored column). Show it next to the score,
e.g. `quality 82 · copyability 0.55 → score 45`, plus the `mirror` reasons when
it's the binding constraint ("leverage 24× — not copyable").

On the on-the-fly path some hard-zero inputs aren't cheaply available
(`capitalBaseKnown`, `looksLikeMarketMaker` need extra queries); v1 recomputes
`C` *without* the hard-zero (defaults: not-a-bot, capital-base-known). If the
worker hard-zeroed it, `composite_score` is already `0` so the page shows `0`
anyway — the displayed `copyability` is just slightly optimistic in that rare
case. Acceptable for v1.

## Implementation

1. **`packages/scoring/src/copyability.ts`** (new, TDD) —
   `computeCopyability(inputs): { value: number /*0..1*/, breakdown }` where
   `breakdown` lists each factor + value + (for `mirror`) the penalties. Pure
   function; ramps via `applyCurve`. Hard-zero for `isMarketMaker` /
   `!capitalBaseKnown` / leverage over the cap.
2. **`packages/scoring/src/index.ts`** — export it.
3. **`packages/scoring/src/composite.ts`** — leave `medianComposite` untouched
   (callers switch from `.score` to `.rawScore`); the `× confidence`/`provisional`
   fields become vestigial. (A later cleanup can remove them once nothing reads
   them.)
4. **`apps/worker/src/jobs/score.ts`** — LEFT JOIN `leader_cache.leverage` into
   the wallet fetch; compute `copyability = computeCopyability({ accountValueUsd,
   roundTrips, daysOfData, leverage, assetConcentration, maxDrawdownPct,
   isMarketMaker: eligibility.failures.includes('market_maker_pattern'),
   capitalBaseKnown })`; set `composite_score = round(quality × copyability.value)`
   where `quality = medianComposite(...).rawScore`. (Curation gate logic kept as
   today for now — see scope note.)
5. **`apps/web/src/lib/server/queries/leader-detail.ts`** + the trader
   `+page.svelte` — recompute `copyability` from the `scores` row + `wallets`
   + `leader_cache` and surface it.
6. `pnpm check` + `pnpm test` (vitest in `packages/scoring`).

No migration. Works on `main` (no schema change needed).
