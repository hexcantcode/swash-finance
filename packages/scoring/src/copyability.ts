import { applyCurve } from './curves.js';

/**
 * Equity at/below this (USD) ⇒ copyability 0 — a withdrawn-out account has no
 * capacity / skin in the game to copy, no matter how much PnL it once realized.
 */
export const MIN_COPYABLE_EQUITY_USD = 2_000;
/** Account-level gross leverage above this ⇒ copyability 0 (a follower copying
 *  it just gets liquidated). */
export const LEVERAGE_HARD_CAP = 20;
/** The soft `mirror` factor is floored here — caps the *soft* discount at 2×. */
const MIRROR_FLOOR = 0.5;

// Interim knee points — flagged for calibration against real HL data, same as
// the metric curves. See docs/plans/2026-05-12-copyability-aware-scoring-design.md.

/** equity → factor. Cliff at $2k; $10k ⇒ 0.5 (barely eligible); full at $100k. */
const CAPITAL_CURVE: [number, number][] = [
  [MIN_COPYABLE_EQUITY_USD, 0],
  [10_000, 0.5],
  [50_000, 0.85],
  [100_000, 1],
];
/** round-trips → factor. Discounted below ~30 (the old eligibility floor); full at/above it. */
const SAMPLE_CURVE: [number, number][] = [
  [0, 0],
  [10, 0.5],
  [30, 1],
];
/** calendar span (days, first→last event) → factor. Full at ~90d; brand-new wallet (0d) ⇒ 0. */
const HISTORY_CURVE: [number, number][] = [
  [0, 0],
  [30, 0.5],
  [90, 1],
];
/** gross leverage → `mirror` penalty. ≤3× none, ramping to −0.5 by 15× (clamped);
 *  past LEVERAGE_HARD_CAP it's a hard exclusion, not a soft penalty. */
const LEVERAGE_PENALTY_CURVE: [number, number][] = [
  [3, 0],
  [15, 0.5],
];
/** single-asset notional share (0..1) → `mirror` penalty. ≤0.5 none, 1.0 ⇒ −0.2. */
const CONCENTRATION_PENALTY_CURVE: [number, number][] = [
  [0.5, 0],
  [1, 0.2],
];

export interface CopyabilityInputs {
  /** account value (USD); null/non-finite ⇒ treated as $0 ⇒ below the floor. */
  accountValueUsd: number | null;
  /** round-trip trades over the whole record; null ⇒ treated as 0. */
  roundTrips: number | null;
  /** calendar span of the record, first→last event, in days. */
  daysOfData: number;
  /** account-level gross leverage (total notional ÷ equity) at the last live
   *  cache refresh; null when we don't track this wallet ⇒ no leverage penalty. */
  leverage: number | null;
  /** notional share of the top asset (0..1); null ⇒ no concentration penalty. */
  assetConcentration: number | null;
  /** max drawdown fraction (0..1) — informational; the quality basket already
   *  scores drawdown, so it is deliberately NOT re-penalized here. */
  maxDrawdownPct: number | null;
  /** market-maker / grid-bot pattern ⇒ hard 0. */
  isMarketMaker: boolean;
  /** false ⇒ PnL can't be trusted (no reconstructable capital base) ⇒ hard 0. */
  capitalBaseKnown: boolean;
}

export interface CopyabilityBreakdown {
  /** equity factor, 0..1 (0 when equity ≤ $2k). */
  capital: number;
  /** sample-size factor, 0..1. */
  sample: number;
  /** track-record-span factor, 0..1. */
  history: number;
  /** strategy-mirrorability factor, 0..1 (floored at 0.5 unless a hard rule fires). */
  mirror: number;
  /** human-readable reasons copyability is below 1 (soft penalties + hard rules). */
  penalties: string[];
  /** a hard rule forced `value` to 0 — bot / no capital base / over-leveraged / sub-$2k equity. */
  excluded: boolean;
}

export interface CopyabilityResult {
  /** 0..1 — `capital · sample · history · mirror`, or 0 when `excluded`. */
  value: number;
  breakdown: CopyabilityBreakdown;
}

function ramp(curve: [number, number][], x: number): number {
  return Number.isFinite(x) ? applyCurve(curve, x) : 0;
}

function round1(x: number): string {
  return (Math.round(x * 10) / 10).toString();
}

/**
 * Copyability `C ∈ [0,1]` — the multiplier applied to the quality score:
 * `composite = round(quality × C)`. It folds the old hard eligibility *floors*
 * into graduated factors, plus a few hard rules:
 *
 *   C = capital · sample · history · mirror
 *   C = 0  if  market-maker pattern | no reconstructable capital base
 *            | gross leverage > LEVERAGE_HARD_CAP | equity ≤ MIN_COPYABLE_EQUITY_USD
 *
 * Equity is the dominant input: an account that's been withdrawn out ($0–$2k)
 * scores 0 regardless of realized PnL — there is nothing copyable left.
 */
export function computeCopyability(input: CopyabilityInputs): CopyabilityResult {
  const penalties: string[] = [];

  const capital = ramp(CAPITAL_CURVE, input.accountValueUsd ?? 0);
  const sample = ramp(SAMPLE_CURVE, input.roundTrips ?? 0);
  const history = ramp(HISTORY_CURVE, input.daysOfData);

  // --- mirror: is the strategy itself copyable? ---
  let mirrorPenalty = 0;
  let leverageOverCap = false;
  const { leverage } = input;
  if (leverage != null) {
    if (leverage > LEVERAGE_HARD_CAP) {
      leverageOverCap = true;
    } else {
      const p = applyCurve(LEVERAGE_PENALTY_CURVE, leverage);
      if (p > 0) {
        mirrorPenalty += p;
        penalties.push(`leverage ${round1(leverage)}× — hard to copy`);
      }
    }
  }
  if (input.assetConcentration != null) {
    const p = applyCurve(CONCENTRATION_PENALTY_CURVE, input.assetConcentration);
    if (p > 0) {
      mirrorPenalty += p;
      penalties.push('single-asset concentration');
    }
  }
  const mirror = Math.max(MIRROR_FLOOR, 1 - mirrorPenalty);

  // --- hard rules ---
  let excluded = false;
  if (input.isMarketMaker) {
    excluded = true;
    penalties.push('market-maker / bot pattern');
  }
  if (!input.capitalBaseKnown) {
    excluded = true;
    penalties.push('no reconstructable capital base');
  }
  if (leverage != null && leverageOverCap) {
    excluded = true;
    penalties.push(`leverage ${round1(leverage)}× — over the ${LEVERAGE_HARD_CAP}× cap`);
  }
  if (capital === 0) {
    excluded = true;
    penalties.push(`equity below the $${MIN_COPYABLE_EQUITY_USD.toLocaleString()} floor`);
  }

  const value = excluded ? 0 : capital * sample * history * mirror;
  return { value, breakdown: { capital, sample, history, mirror, penalties, excluded } };
}
