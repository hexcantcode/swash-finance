import type { AssetTag, HeatTag, ProfileTag, SizeTag } from '@copytrade/shared';

export interface ProfileInputs {
  /** Real round-trip count (position open→flat cycles) over the observed record. */
  roundTrips: number;
  /** Calendar span of the record, first→last event, in days. */
  daysOfData: number;
  /** Days since the most recent trade. */
  lastTradeDaysAgo: number;
  /** Probabilistic Sharpe Ratio (0..1), or null if not computable. */
  psr: number | null;
  /** Max drawdown fraction (0..1), or null. */
  maxDrawdownPct: number | null;
  /** Herfindahl on per-coin notional (0..1, 1 = single asset). */
  assetConcentration: number;
  /** Avg trades per *active* day. */
  tradesPerDayAvg: number;
  /** Asset class of the wallet's primary market, or null. */
  primaryAssetClass: AssetTag | null;
  /** Share of months net-positive / smoothness (0..1), or null. */
  monthlyConsistency: number | null;
  /** Rolling 30d Sharpe (annualized display units), or null. */
  rolling30dSharpe: number | null;
  /** Best rolling-30d Sharpe over the record, or null. */
  peakRollingSharpe: number | null;
  /** Current account equity (USD), or null when unknown. */
  accountValueUsd: number | null;
}

// --- interim thresholds (re-derive from real HL histories; see
//     docs/plans/2026-05-11-curve-calibration-notes.md) ---
const ALPHA_MAX_TRADES_PER_DAY = 5;
const ALPHA_MAX_ROUND_TRIPS = 80;
const ALPHA_MIN_ROUND_TRIPS = 5;
const ALPHA_MIN_PSR = 0.9;
const ALPHA_MAX_DRAWDOWN = 0.3;
const ALPHA_MIN_CONCENTRATION = 0.6;
const ALPHA_MAX_LAST_TRADE_DAYS = 60;

const VETERAN_MIN_DAYS = 60;
const VETERAN_MIN_ROUND_TRIPS = 500;
const VETERAN_MIN_CONSISTENCY = 0.6;
const VETERAN_MIN_PSR = 0.8;

const RISING_STAR_MIN_EQUITY = 25_000;
const RISING_STAR_MAX_EQUITY = 250_000;
const RISING_STAR_FRESH_DAYS = 90;
const RISING_STAR_SMALL_SAMPLE = 150;
const RISING_STAR_MIN_PSR = 0.85;
const RISING_STAR_HEAT_RATIO = 0.85;
const RISING_STAR_MAX_LAST_TRADE_DAYS = 30;

const SPECIALIST_MIN_CONCENTRATION = 0.6;
const SPECIALIST_MIN_ROUND_TRIPS = 50;

/**
 * The trader "Profile" — one archetype per scored wallet, evaluated in priority
 * order so the rarest / highest-signal label wins. The composite score is the
 * headline ("how good"); the profile only says "what kind". Always returns a
 * value (`allrounder` is the catch-all) — nothing renders as "Unclassified".
 *
 * Thresholds below are interim and to be calibrated against real HL data. Note
 * `daysOfData` is the *calendar span* of the record (first→last event), bounded
 * by our ~90-day ingest window — so `veteran`'s `daysOfData >= 60` means
 * "history spans 2/3+ of what we can see", not "365 days".
 */
export function classifyProfile(m: ProfileInputs): ProfileTag {
  // 1. Alpha — moves with information: concentrated, event-driven (low
  //    cadence / small focused sample), lethal hit-rate, controlled drawdown,
  //    not a bluechip-only book. Recently active so a stale wallet doesn't keep
  //    the badge.
  if (
    m.assetConcentration > ALPHA_MIN_CONCENTRATION &&
    m.roundTrips >= ALPHA_MIN_ROUND_TRIPS &&
    (m.tradesPerDayAvg < ALPHA_MAX_TRADES_PER_DAY || m.roundTrips < ALPHA_MAX_ROUND_TRIPS) &&
    m.psr !== null &&
    m.psr > ALPHA_MIN_PSR &&
    m.maxDrawdownPct !== null &&
    m.maxDrawdownPct < ALPHA_MAX_DRAWDOWN &&
    m.primaryAssetClass !== null &&
    m.primaryAssetClass !== 'bluechip' &&
    m.lastTradeDaysAgo <= ALPHA_MAX_LAST_TRADE_DAYS
  ) {
    return 'alpha';
  }

  // 2. Veteran — long observable history, large sample, performance that held up.
  if (
    m.daysOfData >= VETERAN_MIN_DAYS &&
    m.roundTrips >= VETERAN_MIN_ROUND_TRIPS &&
    m.monthlyConsistency !== null &&
    m.monthlyConsistency >= VETERAN_MIN_CONSISTENCY &&
    m.psr !== null &&
    m.psr >= VETERAN_MIN_PSR
  ) {
    return 'veteran';
  }

  // 3. Rising star — small book near the listing floor, short record or modest
  //    sample, with recent Sharpe near its own peak. (The re-tuned `dark_horse`:
  //    a capital window replaces the old "<200 trades" heuristic.)
  if (
    m.accountValueUsd !== null &&
    m.accountValueUsd >= RISING_STAR_MIN_EQUITY &&
    m.accountValueUsd < RISING_STAR_MAX_EQUITY &&
    (m.daysOfData < RISING_STAR_FRESH_DAYS || m.roundTrips < RISING_STAR_SMALL_SAMPLE) &&
    m.psr !== null &&
    m.psr > RISING_STAR_MIN_PSR &&
    m.peakRollingSharpe !== null &&
    m.peakRollingSharpe > 0 &&
    m.rolling30dSharpe !== null &&
    m.rolling30dSharpe >= RISING_STAR_HEAT_RATIO * m.peakRollingSharpe &&
    m.lastTradeDaysAgo <= RISING_STAR_MAX_LAST_TRADE_DAYS
  ) {
    return 'rising_star';
  }

  // 4. Specialist — concentrated one-asset operator who didn't earn `alpha`.
  if (
    m.assetConcentration > SPECIALIST_MIN_CONCENTRATION &&
    m.roundTrips >= SPECIALIST_MIN_ROUND_TRIPS
  ) {
    return 'specialist';
  }

  // 5. All-rounder — catch-all. Every scored wallet gets a profile.
  return 'allrounder';
}

export function classifyHeat(
  recentSharpe: number | null,
  peakSharpe: number | null,
): HeatTag | null {
  if (recentSharpe === null || peakSharpe === null || peakSharpe <= 0) return null;
  const ratio = recentSharpe / peakSharpe;
  if (ratio >= 0.85) return 'hot';
  if (ratio >= 0.5) return 'steady';
  return 'cooling';
}

export function classifySize(totalVolumeUsd: number): SizeTag {
  if (totalVolumeUsd >= 100_000_000) return 'whale';
  if (totalVolumeUsd >= 10_000_000) return 'mid';
  if (totalVolumeUsd >= 1_000_000) return 'small';
  return 'micro';
}

/**
 * Map a coin (with optional HIP-3 prefix) to an asset class. Used both for
 * per-fill classification during ingestion and for the wallet-level "primary
 * asset class" derived from `primaryAsset` (shown as a plain stat, and an input
 * to the `alpha` profile rule).
 */
export function classifyAssetClass(
  coin: string,
  hip3Dexes: Set<string>,
): AssetTag {
  const colon = coin.indexOf(':');
  if (colon !== -1) {
    const dex = coin.slice(0, colon);
    if (hip3Dexes.has(dex)) {
      const lowerDex = dex.toLowerCase();
      if (lowerDex.includes('stock')) return 'stocks';
    }
  }
  const symbol = colon === -1 ? coin : coin.slice(colon + 1);
  const upper = symbol.toUpperCase();
  if (upper === 'BTC' || upper === 'ETH' || upper === 'SOL') return 'bluechip';
  if (
    upper.includes('PEPE') ||
    upper.includes('DOGE') ||
    upper.includes('SHIB') ||
    upper.includes('WIF') ||
    upper.includes('BONK') ||
    upper.includes('TRUMP') ||
    upper.includes('MEME')
  ) {
    return 'meme';
  }
  return 'altcoin';
}

/**
 * Trader-page badge — is this wallet's recent track record close to its peak
 * Sharpe (green), losing edge (yellow), or in serious decay (red)? Written to
 * `scores.decay_flag` as a display-only signal; the v2 score doesn't read it.
 *
 *  - green:  recent within 20% of peak Sharpe
 *  - yellow: recent 50-80% of peak
 *  - red:    recent < 50% of peak, or recent Sharpe is negative
 */
export function computeDecayFlag(
  recentSharpe: number | null,
  peakSharpe: number | null,
): 'green' | 'yellow' | 'red' | null {
  if (recentSharpe === null || peakSharpe === null || peakSharpe <= 0) return null;
  if (recentSharpe < 0) return 'red';
  const ratio = recentSharpe / peakSharpe;
  if (ratio >= 0.8) return 'green';
  if (ratio >= 0.5) return 'yellow';
  return 'red';
}
