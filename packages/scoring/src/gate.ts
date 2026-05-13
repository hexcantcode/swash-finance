import { MIN_ACCOUNT_VALUE_USD } from './eligibility.js';

/**
 * Hard pass/fail rules that decide whether a wallet is *eligible* to be
 * scored at all. Failing wallets get `score = NULL` and render as `—`. This
 * replaces the layered eligibility checks (round-trip count, capital base,
 * leverage cap, data-quality cap, composite ≥ 70 curation threshold) with
 * three rules that each map to a column we already have.
 */

/** Activity window: last fill must be at or within this many ms of `now`. */
export const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface GateInputs {
  /** account value in USD; null/undefined ⇒ treated as not-yet-known ⇒ fails. */
  accountValueUsd: number | null;
  /** ms timestamp of the most recent fill on this wallet; null ⇒ no activity recorded ⇒ fails. */
  lastFillMs: number | null;
  /** market-maker / grid-bot pattern detected (existing `classifyProfile`). */
  isMarketMaker: boolean;
  /** ms timestamp of "now" — explicit so the function is deterministic in tests. */
  nowMs: number;
}

export interface GateResult {
  passed: boolean;
  /** Stable string keys, surfaced on the trader page ("equity below $25k", etc). */
  failures: string[];
}

export function passesGate(input: GateInputs): GateResult {
  const failures: string[] = [];

  if (input.accountValueUsd === null || input.accountValueUsd < MIN_ACCOUNT_VALUE_USD) {
    failures.push('equity_below_min');
  }

  if (input.lastFillMs === null || input.lastFillMs < input.nowMs - ACTIVE_WINDOW_MS) {
    failures.push('inactive_30d');
  }

  if (input.isMarketMaker) {
    failures.push('market_maker_pattern');
  }

  return { passed: failures.length === 0, failures };
}
