# Swash — Score v2 (the simple one)

**Date:** 2026-05-13
**Status:** Design agreed; implementation starting in this session.
**Motivates:** The current `composite_score` combines 7 metric curves × 4 copyability factors × hard-zero cliffs + a data-quality cap. When Loracle scored 0 yesterday, three of those four failure modes fired at once — you couldn't tell *which* one was the answer until you read every gate. The whole leaderboard ranks by this number, and the user can't trust the numbers they see.

---

## 0. Problem

`composite_score = round( median(7 metric-curves) × (capital × sample × history × mirror) )`. ~20 tunable knobs, four hard-zero conditions, one cap at 49 when `netPnlPct = null`. Side effects of this complexity:

- **Whales score 0 for unrelated reasons.** Loracle ($14M / 7d): `too_few_round_trips` (continuous exposure), `capital_base_unknown` (fund-style deposits) → copyability = 0 → composite = 0. He IS uncopyable, but our number doesn't tell you which gate failed.
- **The number can't be explained on a trader page.** "Quality 70, copyability 0" is two abstractions stacked on top of seven more.
- **Tuning is fragile.** Changing one curve cascades through the median; you can't sanity-check a knob in isolation.

We want one number whose math fits in five lines and whose breakdown is printable as a per-trader caption.

## 1. The change in shape

Same intent — one 0-100 number meaning "how copy-eligible is this trader". Two stages instead of one nested formula:

1. **Gate** — three hard pass/fail rules. Fail any → `score = NULL`, display `—`. Most of the 6,233 wallets in our DB land here and that's fine.
2. **Score** — for gate-passers, a weighted average of three signals on absolute linear bands. ~3 knobs total.

The column is renamed `composite_score → score` everywhere — DB, types, UI label.

## 2. The gate

All three must be true. Each maps to a column we already have, each fails for an obvious reason.

| # | Rule | Source |
|---|---|---|
| 1 | `wallets.account_value >= 25000` | live tier (`leader_cache` / `webData2`) |
| 2 | most-recent fill within 30d | `max(fills.block_time_ms)` |
| 3 | not flagged as bot / market-maker | existing `market_maker_pattern` detection |

**Dropped from today's gate set:**

- `composite ≥ 70` (curation threshold) — replaced by "passes the 3 gates". No double-threshold.
- `too_few_round_trips` — moved to a display caveat ("limited history"), not an exclusion. A wallet with 3 round-trips can still score; uncertainty is reflected in the inputs themselves.
- `capital_base_unknown` — gone. The new score uses HL's reported 30d ROI directly; deposit-base reconstruction is no longer in the path.
- `leverage > 20×` — relaxed; account-level leverage is now an input to the **risk** band, not a hard cliff.

## 3. The formula

For a wallet that clears the gate:

```
score = round( 0.40 × profit_pts + 0.30 × consistency_pts + 0.30 × risk_pts )
```

Each term is on a single linear band, clamped to 0-100:

| Term | Input | Source | Map (linear) |
|---|---|---|---|
| **profit** | 30d realized ROI (decimal) | `wallets.hl_roi_30d` | `roi / 0.50 × 100`; +50% ROI → 100, 0% → 0 |
| **consistency** | profitable weeks / total weeks over 90d | computed from `fills` | `pct × 100` |
| **risk** | max drawdown over 90d (decimal magnitude) | `scores.max_drawdown_pct` | `(1 − dd/0.50) × 100`; 0% DD → 100, ≥50% DD → 0 |

**Consistency window:** walk `fills` for the last 90 days, bucket `closed_pnl` by ISO week, count buckets where `sum > 0`, divide by total buckets that contain *any* activity (not 13 — a wallet that traded in 11 of 13 weeks is judged on those 11).

**Worked example.** 30d ROI = +30%, 9 of 13 weeks profitable, max DD = -15%:

- `profit_pts = 30/50 × 100 = 60`
- `consistency_pts = 9/13 × 100 = 69`
- `risk_pts = (1 - 15/50) × 100 = 70`
- `score = round(0.4·60 + 0.3·69 + 0.3·70) = 66`

Renders on the trader page as `+24  +21  +21 = 66`.

**Missing data:** if any of the three inputs is `NULL` at score-compute time (gate passed but data isn't there yet — e.g. a freshly-queued wallet), `score = NULL` and display `—`. Never silently substitute zeros for missing inputs.

## 4. Implementation

### New code

```
packages/scoring/src/
  score.ts        // computeScore(inputs) → { score, breakdown } | null
  score.test.ts   // band edges, clamping, missing-data, worked example
  gate.ts         // passesGate(wallet) → { passed: bool; failures: string[] }
  gate.test.ts
```

`score.ts` is ~50 lines of arithmetic. `gate.ts` is ~30 lines of three checks. TDD throughout — write each test before its implementation; verify each fails first.

### Code deleted

- `composite.ts` + `composite.test.ts` (medianComposite of 7-metric basket).
- `copyability.ts` + `copyability.test.ts` (capital × sample × history × mirror).
- The metric-normalization curve set in `curves.ts` (Sharpe / Sortino / PSR / PF / DD / recovery / consistency curves). Single linear bands replace them.
- `applyCurve` helper if nothing else uses it (probably nothing — check before deleting).
- `psr.ts` — only fed `composite`; goes away.

### Code kept but unwired from the score

Sharpe / Sortino / win-rate / profit-factor / max-drawdown / monthly-consistency stay in `metrics.ts` / `returns.ts` — they're still computed and written to `scores.*` as **display-only stats** for the trader page. They no longer feed back into the score number.

### Worker (`apps/worker/src/jobs/score.ts`)

```
1. fetch wallet + fills + ledger + leader_cache for address
2. gate = passesGate(wallet, fills); if fail → score = NULL, return
3. profit = wallets.hl_roi_30d; consistency = weeksFromFills(fills); risk = maxDrawdownOver90d(fills)
4. { score, breakdown } = computeScore({ profit, consistency, risk })
5. upsert scores.* (score + display stats), update wallets.score
```

Drop: `eligibility.eligible` branching, the data-quality cap at 49, `wasCurated`/`curatedSince`. `wallets.curated` becomes a derived `wallets.score IS NOT NULL` (or stays as a column that mirrors that boolean — decide at implementation time).

### Schema migration

Two ALTERs via the Neon MCP path (no Drizzle migration on `main`):

```sql
ALTER TABLE wallets RENAME COLUMN composite_score TO score;
ALTER TABLE scores  RENAME COLUMN composite_score TO score;
```

Update `packages/db/src/schema.ts` field names: `compositeScore → score` on both tables.

### Web consumers

Trace `compositeScore` / `composite_score` across `apps/web/src/lib/server/queries/*`, `apps/web/src/routes/*`, `apps/web/src/lib/components/*`. Rename references; replace the "score column" UI with the new three-part breakdown for the trader page.

Methodology page rewritten as: gate list (3 bullets) + formula (5 lines) + band definitions (3 rows of a table). Done.

## 5. Migration + done definition

The task is finished when:

1. `packages/scoring` ships `score.ts` + `gate.ts` with tests passing — every band edge, every missing-data case.
2. `wallets.composite_score` and `scores.composite_score` are renamed to `score` in the live DB; Drizzle schema updated; `pnpm check` clean across worker + web.
3. `score.ts` worker job recomputed every wallet — new scores in the DB. Old `composite.ts` / `copyability.ts` / `psr.ts` deleted.
4. `/` renders the leaderboard sorted by `wallets.score desc`, with the gate-filter applied. Top names show meaningful 50-90 scores; long-tail zeros are gone.
5. Trader page (`/trader/<addr>`) shows the new score with its three-part breakdown, or a "Not currently copy-eligible" panel listing the failed gates.
6. Hyperdash whales (Loracle, Fasanara) either show a real copy-eligibility score, or — more likely — they fail the gate cleanly and stay only on the Top Earners surface. Either outcome is acceptable; the test is that the *reason* is readable from the simple rules.

Out of scope for this PR (worth later): the trader-page methodology copy refresh, the "Best to Copy" home-page card section as a separate surface from "Top Earners", any algorithmic re-weighting of the 40/30/30 split based on calibration data.
