# Trader traits — plain-language insight layer

Date: 2026-06-10 · Status: approved, implementing

Turn the classifier output the worker already computes (archetype, heat,
size, asset class, decay) into insight a non-financial user can read in
one line. Detail page carries the richness; cards get exactly one new
signal.

## Bio generator

`traderBio(...)` in `packages/shared` — one pure, deterministic composer
(no LLM, no randomness), unit-tested. At most two clauses + one qualifier:

- **Lead = archetype**, normie English: Veteran → "Battle-tested",
  Alpha → "Makes rare, precise bets", Specialist → "Lives in one market",
  All-Rounder → "Steady, diversified trader". **Rising Star keeps its
  name** ("Rising star with strong recent form").
- **Texture = size + dominant market** (from size tag +
  `primary_asset_breakdown`).
- **Rhythm = hold style** from `avg_hold_seconds` (hours / within the
  day / days / a week or two).
- **Qualifier = heat/decay, honest but calm**: hot → "on a hot streak";
  cooling or decay yellow/red → "though results have cooled lately".

Degradation: every input optional; missing trait = dropped clause, never
"—". No archetype → no bio.

## Detail hero

avatar · address · score block → **bio line** (subhead, secondary) →
**chips row** (replaces the lone archetype chip): Archetype (existing
tag tints) · Size (neutral) · Market (neutral) · Heat (accent-subtle
"Hot streak" / warning-subtle "Cooled lately"). Every chip taps open a
trait sheet — `appSheet` grows a `{kind:'trait', trait}` variant; copy
lives in `TRAIT_EXPLAINERS` in `packages/shared` (1 paragraph + one
"what to make of it" line, de-jargoned). Same interaction grammar as the
score ⓘ: labeled thing → tap → plain explanation.

## Cards

One element only: a **"Hot" micro-chip** after the address on
`MobileTraderCard` and `MobileLeaderRow`, shown only when heat = hot.
Steady/cooling render nothing on cards (cooling truth lives on detail —
cards triage, detail tells the whole story; we never compress a warning
into a space too small to be fair). Smallest chip in the badge family
(accent-subtle, 10px uppercase mono). Not separately tappable on cards.

## Backend touch

Verify `/api/leaders` and `/api/leaders/top` carry the full `tags` array
(heat included); widen the canonical query if not. Only backend change.

## Out of scope

Tag filtering/sorting, decay UI beyond the "cooled lately" fold-in,
asset-class chips on cards, new classifier logic, web-app parity.
