# Leaderboard cleanup + "Profile" tag redesign — design

Date: 2026-05-12
Status: implemented on branch `profile-tags-leaderboard` (worktree). `pnpm check` clean; `pnpm --filter @copytrade/scoring test` green (138).

## Post-deploy step (not a migration — see CLAUDE.md on the migration drift)

After deploying, run a full `runScoreRecompute()` so every candidate wallet's
`wallet_tags` is rewritten to the `profile/heat/size` groups and `wallets.primary_tag`
gets a new-taxonomy value. Stale rows for wallets that are no longer scoring
candidates (e.g. now below the strict $25k floor) are harmless — they never reach
`leaders.ts` — but you may also run `DELETE FROM wallet_tags WHERE tag_type IN
('main','asset','cadence','risk');` to tidy up. Until the re-score runs, any
still-listed wallet shows its old `primary_tag` rendered via the de-snake fallback
(`alpha_hunter` → "alpha hunter", unstyled chip).

## Goal

A leaderboard that (a) is built from real HL data with one consistent account-value
floor, (b) ranks purely by our composite score, and (c) carries a small set of
**informational** secondary tags — no filter sprawl, no taxonomy that competes with
the score for attention.

Decisions (from brainstorm 2026-05-12):

- **The composite score is the headline.** There is no "primary tag" chip anymore.
- **Secondary tag groups kept: `profile`, `heat`, `size`.** Everything else
  (`cadence`, `risk`, `asset`) is **removed** as a tag group — those quantities are
  still computed and shown as plain numbers on the trader page; they just stop being
  filterable chips.
- **No `directional` archetype.** Keep it simple.
- **"Last active" → "Frequency".** The leaderboard's `last_active` column + sort
  option are replaced by a **Frequency** column showing the trader's weekly trade
  average. Canonical source: `scores.tradesPerDayAvg` (already computed —
  `fills.length / activeDays`); the weekly figure is `tradesPerDayAvg × 7`, derived
  once in `leaders.ts` (a pure display transform of the existing canonical value,
  same pattern as `roi` there). Sort key `'frequency'` orders by
  `scores.tradesPerDayAvg DESC`. `scores.lastTradeAt` stays in the DB and on the
  trader page; it just stops being a leaderboard column/sort.
- The current `MainTag` group (`alpha_hunter / veteran / insider / specialist /
  dark_horse / generalist`) is **reworked into the `profile` group** with five
  values.

## Current state (verified 2026-05-12)

Pipeline: HL leaderboard API (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`,
~35.5k rows, `{ethAddress, accountValue, displayName, prize, windowPerformances}`) →
`leaderboard-poll` (top-100 7d-ROI ∪ top-100 allTime-PnL) + `leaderboard-ingest`
(top-5000 persist / top-1000 deep-queue by 30d PnL) → `discovery_queue` →
`refresh-queue` deep-ingest → `score.ts` (`quality = median of 7 normalized curves`,
`copyability ∈ [0,1]`, `composite = round(quality × copyability)`, writes
`wallet_tags` rows for `main/asset/cadence/risk/heat/size`, sets `wallets.curated`
when eligible & composite ≥ 70) → `leaders.ts` query
(`WHERE isAgent=false AND compositeScore IS NOT NULL AND accountValue ≥ 25_000
ORDER BY compositeScore DESC`). "Top 100" is just that ordering; the homepage paginates 25/page.

### Logic issues found

1. **Two account-value floors.** `hl-client/leaderboard.ts:isEligible` defaults to
   `$1k` / `$10k`-vol; `leaderboard-poll` / `leaderboard-ingest` pass no override, so
   the sweep deep-ingests + scores thousands of sub-$25k wallets that `leaders.ts`
   drops at display. (`leaderboard-poll.ts` is already mid-edit to import
   `MIN_ACCOUNT_VALUE_USD`; finish the job for `leaderboard-ingest.ts` too and the
   `topQueue` ranking.)
2. `score.ts` candidate filter lets `accountValue IS NULL` through → those wallets
   get a composite but can never appear (`null ≥ 25000` is false). Fetch equity
   first, or skip.
3. **`roundTripTrades` is faked as `fills.length`** everywhere (curation
   `MIN_ROUND_TRIPS`, copyability, classifier). Need a real round-trip count — also a
   prerequisite for the `alpha` / `rising_star` profile rules below.
4. Dead code: the old additive `computeComposite` (8 binary criteria, saturates at
   90–100) is unused since `medianComposite` + `copyability` landed. Remove.
5. Winner-strip floor: keep at `MIN_ACCOUNT_VALUE_USD` ($25k) — already being changed
   on `main`. (Winners is a "hot right now" lens; same floor as the list keeps the
   two consistent.)
6. `displayName` is in the HL payload and unused — optional: surface it on the
   trader page.

## The `profile` tag group (replaces `MainTag`)

Exactly one per scored wallet, priority-ordered (rarest / highest-signal wins). All
thresholds below are **interim** and to be re-derived in
`docs/plans/2026-05-11-curve-calibration-notes.md` against real HL histories.

| Priority | Value | Reads as | Interim rule |
|---|---|---|---|
| 1 | `alpha` | "moves with information" — event-driven, concentrated, lethal hit-rate | `assetConcentration > 0.6` ∧ `roundTrips < ~80` (or `tradesPerDayAvg < ~5`) ∧ `psr > 0.9` (or `winRate ≥ ~0.6` ∧ `profitFactor > 1.5`) ∧ `maxDrawdownPct < 0.3` ∧ `primaryAssetClass ≠ 'bluechip'`. Absorbs the old `insider`. |
| 2 | `veteran` | battle-tested — long observable history, high sample, consistent | `daysOfData ≥ 60` ∧ `roundTrips ≥ ~500` ∧ `monthlyConsistency ≥ ~0.6` ∧ `psr ≥ 0.8`. |
| 3 | `rising_star` | small book near the listing floor, strong recent form | `25_000 ≤ accountValue < ~250_000` ∧ (`daysOfData < 90` ∨ `roundTrips < ~150`) ∧ `psr > 0.85` ∧ `rolling30dSharpe ≥ 0.85 × peakRollingSharpe` ∧ `lastTradeDaysAgo ≤ 30`. (Re-tuned `dark_horse` — capital window replaces the `<200 trades` heuristic.) |
| 4 | `specialist` | one-asset operator, no info edge proven | `assetConcentration > 0.6` ∧ `roundTrips ≥ ~50` (didn't clear `alpha`). |
| 5 | `allrounder` | solid, active, diversified — no sharper archetype | catch-all (renamed from `generalist` — a capability, not a demotion). Every scored wallet still gets a profile. |

Labels: `Alpha`, `Veteran`, `Rising Star`, `Specialist`, `All-Rounder`.

`heat` (`hot / steady / cooling`, from `rolling30dSharpe / peakRollingSharpe`) and
`size` (`whale / mid / small / micro`, from lifetime volume) are unchanged.

## Changes — by file

DB / scoring:
- `packages/scoring/src/classifier.ts` — replace `classifyMainTag` with
  `classifyProfile` returning the 5 new values; delete `classifyCadence`,
  `classifyRisk`, `classifyAssetClass`'s tag use (keep `classifyAssetClass` itself —
  still used to derive `primaryAssetClass` for the `alpha` rule and the
  `scores.primaryAsset` display). `classifyHeat`, `classifySize` stay.
- `packages/scoring/src/composite.ts` — delete `computeComposite` /
  `CompositeInputs` / `CompositeBreakdown` (dead). Keep `medianComposite`,
  `computeDecayFlag`.
- `packages/scoring/src/index.ts` — update exports.
- A real **round-trip count** from the fill stream (position open→flat per coin),
  threaded into `score.ts` → `evaluateEligibility.roundTripTrades`,
  `computeCopyability.roundTrips`, `classifyProfile`, and `scores.totalRoundTrips`
  (currently hard-coded `0`).
- `packages/shared/src/types.ts` — `MainTag → ProfileTag` (`alpha | veteran |
  rising_star | specialist | allrounder`); delete `CadenceTag`, `RiskTag`,
  `AssetTag`; update `TagType` (`'profile' | 'heat' | 'size'`), `SecondaryTags`,
  `MAIN_TAG_LABELS/DESCRIPTIONS` → `PROFILE_TAG_*`.
- `apps/worker/src/jobs/score.ts` — call `classifyProfile`; stop writing
  `cadence`/`risk`/`asset` `wallet_tags` rows; write `tag_type='profile'`; thread
  round-trips; tighten the candidate filter (drop the `accountValue IS NULL` pass or
  pre-fetch equity).
- `apps/worker/src/jobs/leaderboard-ingest.ts` (and finish `leaderboard-poll.ts`) —
  use `MIN_ACCOUNT_VALUE_USD` as the eligibility floor and the deep-queue ranking
  cutoff.
- One-off migration / cleanup: `DELETE FROM wallet_tags WHERE tag_type IN
  ('cadence','risk','asset');` and rename `tag_type='main' → 'profile'` + remap the
  old values (`alpha_hunter→alpha`, `insider→alpha` *only if it still qualifies —
  otherwise let the next score run reclassify*, `dark_horse→rising_star`,
  `generalist→allrounder`, `veteran/specialist` unchanged). Simplest: just let the
  next `score` run rewrite all tags, and do a single bulk `DELETE FROM wallet_tags`
  + clear `wallets.primary_tag` first. **Coordinate with the `main`/`data-sources`
  migration drift before adding a migration file** (see CLAUDE.md).

Web:
- `apps/web/src/lib/utils/tags.ts` — `mainTag* → profileTag*` label map for 5
  values.
- `apps/web/src/lib/server/queries/leaders.ts` — `BrowseFilters`: drop `assetTag`,
  `riskTag`, `cadenceTag`; rename `mainTag → profileTag`; the EXISTS tag-filter loop
  drops those types; `secondary_tags` array now only carries `heat:` / `size:`
  (`profile` surfaces via `primary_tag`/its own field).
- `apps/web/src/routes/+page.server.ts`, `apps/web/src/routes/api/leaders/+server.ts`
  — query schemas: drop `asset`/`risk`/`cadence`, rename `tag→profile`; replace the
  `last_active` sort enum value with `frequency`.
- `apps/web/src/lib/server/queries/leaders.ts` — also: `sort` type
  `'composite_score' | 'roi' | 'frequency'`; `orderColumn` maps `frequency →
  scores.tradesPerDayAvg`; `LeaderCard.metrics` gains `trades_per_week`
  (`tradesPerDayAvg × 7`, null when `tradesPerDayAvg` null).
- `apps/web/src/routes/+page.svelte`, `LeaderTable.svelte`,
  `trader/[address]/+page.svelte` — remove the asset/risk/cadence filter chips +
  card badges; relabel the `main` chip to "Profile" with the new values; keep
  heat/size badges. Replace the "Last active" leaderboard column + sort toggle with
  "Frequency" (`~N trades/wk`, formatted in `$lib/utils/format.ts`). Show
  `avgHoldSeconds`, `maxDrawdownPct`, `longShortRatio`, `primaryAsset`, and
  `lastTradeAt` as plain stats on the trader page (no chip).
- `apps/web/src/routes/methodology/+page.svelte` — rewrite the tag section to the new
  `profile` taxonomy + the score-is-the-headline framing.
- `leader-detail.ts`, `weekly-leaders.ts`, `recent-trades.ts` — adjust any
  `secondary_tags` / tag-type references.
- `classifier.test.ts` — rewrite for `classifyProfile`; delete cadence/risk tests.

## Out of scope / deferred

- `displayName` surfacing — nice-to-have, separate small PR.
- WS-discovery tooling, on-demand scoring path changes — unchanged.
- Curve / threshold calibration against real histories — tracked separately; ship the
  taxonomy with interim numbers, tune after.

## Verification

- `pnpm check` clean (no stale `MainTag` / `cadenceTag` / `assetTag` references —
  grep `apps/web/src` + `packages/`).
- `pnpm --filter @copytrade/scoring test` green (new `classifyProfile` tests).
- Manual: run `score` on a handful of known wallets (one obviously concentrated +
  high-PSR, one long-tenured, one small-book recent winner, one diversified) and
  confirm the profile + score match intuition.
- Leaderboard page renders with only `profile / heat / size` chips; sub-$25k wallets
  absent; ranking strictly by composite.
