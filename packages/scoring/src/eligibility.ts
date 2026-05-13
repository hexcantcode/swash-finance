/**
 * Curation eligibility gate.
 *
 * A wallet is added to the curated "best traders" list only if it passes this
 * gate AND scores composite >= 70 (with ~65 hysteresis); see
 * docs/plans/2026-05-11-data-sources-design.md §2.1. This module is just the
 * gate — a pure function called from both the leaderboard-poll job and the
 * on-demand path. All inputs are pre-fetched by the caller.
 *
 * Lives in packages/scoring (not apps/worker, as the design doc suggested) so
 * it's unit-tested under vitest.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimum account value (USD). Also the floor to even be *listed* on the
 *  leaderboard — below this we don't score or surface the wallet at all. */
export const MIN_ACCOUNT_VALUE_USD = 25_000;
/** Minimum lifetime traded volume (USD). */
export const MIN_TOTAL_VOLUME_USD = 100_000;
/** Minimum track-record age (days since earliest known activity). */
export const MIN_TRACK_RECORD_DAYS = 90;
/** Minimum number of distinct active trading days. */
export const MIN_ACTIVE_DAYS = 30;
// TODO(calibration): set from the real round-trip distribution — interim 30; see docs/plans/2026-05-11-curve-calibration-notes.md
export const MIN_ROUND_TRIPS = 30;

// --- market-maker / grid-bot detection thresholds ---
// A wallet is treated as a market maker / grid bot only when ALL of these hold
// (and the relevant signal is present). It gets a "market maker" tag elsewhere;
// here it just means "not eligible for the curated list".
export const MM_MAX_MAKER_SHARE = 0.95;
export const MM_MAX_AVG_HOLD_SECONDS = 60;
export const MM_LONG_SHORT_BALANCE_TOLERANCE = 0.1;
export const MM_MIN_FILLS = 1000;

export interface EligibilityInputs {
  accountValueUsd: number | null;
  totalVolumeUsd: number | null;
  firstSeenMs: number; // epoch ms of earliest known activity (earliest of first-trade / first-seen)
  activeDays: number;
  roundTripTrades: number | null; // interim: total fills as a proxy; null = skip the check
  capitalBaseKnown: boolean; // true if the wallet has >=1 visible deposit ledger row
  // market-maker / grid-bot signals — only fails if ALL are present and extreme
  makerShare: number | null; // 0..1
  avgHoldSeconds: number | null;
  longShortRatio: number | null; // 0..1, 0.5 = balanced
  totalFills: number | null;
  nowMs?: number; // for testing; defaults to Date.now()
}

export type EligibilityFailure =
  | 'account_value_below_floor'
  | 'volume_below_floor'
  | 'track_record_too_short'
  | 'too_few_active_days'
  | 'too_few_round_trips'
  | 'capital_base_unknown'
  | 'market_maker_pattern';

export interface EligibilityResult {
  eligible: boolean;
  failures: EligibilityFailure[];
}

/** Subset of `EligibilityInputs` needed for the bot/MM-pattern check.
 *  Exported so the new gate (gate.ts) can call this without the rest of
 *  `evaluateEligibility`'s legacy gate logic. */
export interface MarketMakerInputs {
  makerShare: number | null;
  avgHoldSeconds: number | null;
  longShortRatio: number | null;
  totalFills: number | null;
}

/** True when ALL the market-maker / grid-bot signals fire together.
 *  Single source of truth; called from both `evaluateEligibility` and the new
 *  `passesGate` path. */
export function isMarketMakerPattern(input: MarketMakerInputs): boolean {
  return (
    input.makerShare != null &&
    input.makerShare > MM_MAX_MAKER_SHARE &&
    input.avgHoldSeconds != null &&
    input.avgHoldSeconds < MM_MAX_AVG_HOLD_SECONDS &&
    input.longShortRatio != null &&
    Math.abs(input.longShortRatio - 0.5) < MM_LONG_SHORT_BALANCE_TOLERANCE &&
    input.totalFills != null &&
    input.totalFills > MM_MIN_FILLS
  );
}

export function evaluateEligibility(input: EligibilityInputs): EligibilityResult {
  const nowMs = input.nowMs ?? Date.now();
  const failures: EligibilityFailure[] = [];

  // Null accountValue → fail (per design; we do not allow null-through here).
  if (input.accountValueUsd == null || input.accountValueUsd < MIN_ACCOUNT_VALUE_USD) {
    failures.push('account_value_below_floor');
  }

  if (input.totalVolumeUsd == null || input.totalVolumeUsd < MIN_TOTAL_VOLUME_USD) {
    failures.push('volume_below_floor');
  }

  const trackRecordDays = (nowMs - input.firstSeenMs) / DAY_MS;
  if (!(trackRecordDays >= MIN_TRACK_RECORD_DAYS)) {
    failures.push('track_record_too_short');
  }

  if (!(input.activeDays >= MIN_ACTIVE_DAYS)) {
    failures.push('too_few_active_days');
  }

  // Interim: we don't have a precise round-trip count from the pipeline yet.
  // Caller passes a proxy (e.g. total fills); null → skip this check entirely.
  if (input.roundTripTrades != null && input.roundTripTrades < MIN_ROUND_TRIPS) {
    failures.push('too_few_round_trips');
  }

  if (!input.capitalBaseKnown) {
    // "no reconstructable capital base"
    failures.push('capital_base_unknown');
  }

  if (isMarketMakerPattern(input)) {
    failures.push('market_maker_pattern');
  }

  return { eligible: failures.length === 0, failures };
}
