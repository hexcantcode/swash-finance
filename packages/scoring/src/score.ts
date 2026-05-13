/**
 * The Swash copy-eligibility score. One number 0-100 made of three obvious
 * ingredients on linear bands. Replaces the 7-metric basket × 4-factor
 * copyability product that nobody could explain.
 *
 * For wallets that clear `passesGate` (see ./gate.ts):
 *
 *   score = round( 0.40 × profit_pts + 0.30 × consistency_pts + 0.30 × risk_pts )
 *
 * where each `*_pts` is a linear band clamped to 0-100. Any input null/NaN
 * ⇒ overall score is null and the caller renders `—` (we don't silently
 * substitute zeros for missing inputs).
 *
 * Design: docs/plans/2026-05-13-score-v2-design.md
 */

/** profit band: 0% ROI ⇒ 0, +50% ROI ⇒ 100, linear, clamped. */
const PROFIT_BAND_TOP_ROI = 0.5;
/** risk band: 0% drawdown ⇒ 100, ≥50% drawdown ⇒ 0, linear, clamped. */
const RISK_BAND_TOP_DD = 0.5;

const WEIGHT_PROFIT = 0.4;
const WEIGHT_CONSISTENCY = 0.3;
const WEIGHT_RISK = 0.3;

export interface ScoreInputs {
  /** 30d realized ROI as a decimal (0.30 = +30%). Null when we can't read it. */
  roi30d: number | null;
  /** profitable_weeks / weeks_with_activity over 90d, decimal 0..1. */
  weeksProfitableRatio: number | null;
  /** max drawdown magnitude over 90d, decimal 0..1 (0.15 = -15%). */
  maxDrawdownPct: number | null;
}

export interface ScoreBreakdown {
  profit: number;
  consistency: number;
  risk: number;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function present(v: number | null): v is number {
  return v !== null && Number.isFinite(v);
}

export function computeScore(input: ScoreInputs): ScoreResult | null {
  if (!present(input.roi30d) || !present(input.weeksProfitableRatio) || !present(input.maxDrawdownPct)) {
    return null;
  }

  const profit = clamp((input.roi30d / PROFIT_BAND_TOP_ROI) * 100, 0, 100);
  const consistency = clamp(input.weeksProfitableRatio * 100, 0, 100);
  const risk = clamp((1 - input.maxDrawdownPct / RISK_BAND_TOP_DD) * 100, 0, 100);

  const score = Math.round(
    WEIGHT_PROFIT * profit + WEIGHT_CONSISTENCY * consistency + WEIGHT_RISK * risk,
  );

  return {
    score,
    breakdown: {
      profit: Math.round(profit),
      consistency: Math.round(consistency),
      risk: Math.round(risk),
    },
  };
}
