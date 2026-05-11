import { mean, sampleStandardDeviation } from 'simple-statistics';

const TRADING_DAYS_PER_YEAR = 365;

export interface RatioMetrics {
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  maxDrawdownPct: number | null;
  recoveryTimeDays: number | null;
  profitFactor: number | null;
  winRate: number | null;
  expectancy: number | null;
}

/** Annualized Sharpe from daily excess returns (rf assumed 0 for crypto). */
export function annualizedSharpe(returns: number[], periodsPerYear = TRADING_DAYS_PER_YEAR): number | null {
  if (returns.length < 2) return null;
  const sd = sampleStandardDeviation(returns);
  if (sd === 0 || !Number.isFinite(sd)) return null;
  return (mean(returns) / sd) * Math.sqrt(periodsPerYear);
}

/** Annualized Sortino: mean / stddev(downside-only) * sqrt(periods). */
export function annualizedSortino(
  returns: number[],
  periodsPerYear = TRADING_DAYS_PER_YEAR,
): number | null {
  if (returns.length < 2) return null;
  const m = mean(returns);
  const downside = returns.filter((r) => r < 0);
  if (downside.length < 1) return null;
  // Population stddev across all returns, but only counting downside variance.
  const variance =
    downside.reduce((acc, r) => acc + r * r, 0) / Math.max(returns.length - 1, 1);
  const sd = Math.sqrt(variance);
  if (sd === 0 || !Number.isFinite(sd)) return null;
  return (m / sd) * Math.sqrt(periodsPerYear);
}

/** Maximum drawdown from a return series. Returns a positive fraction (0..1). */
export function maxDrawdownPct(returns: number[]): number | null {
  if (returns.length === 0) return null;
  let cum = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of returns) {
    // Clamp r to (-1, ∞) so cum stays positive; a -100% day means total loss.
    const safe = r <= -1 ? -0.999999 : r;
    cum *= 1 + safe;
    if (cum > peak) peak = cum;
    const dd = peak === 0 ? 0 : (peak - cum) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return Math.min(maxDd, 1);
}

/** Calmar = annualized return / max drawdown. */
export function calmar(
  returns: number[],
  periodsPerYear = TRADING_DAYS_PER_YEAR,
): number | null {
  if (returns.length === 0) return null;
  const dd = maxDrawdownPct(returns);
  if (dd === null || dd === 0) return null;
  const annualizedReturn =
    Math.pow(returns.reduce((acc, r) => acc * (1 + r), 1), periodsPerYear / returns.length) - 1;
  return annualizedReturn / dd;
}

/**
 * Recovery time in days: longest gap between a peak and the day equity recovers to that peak.
 * Returns null if no drawdown ever recovered (or no drawdown).
 */
export function recoveryTimeDays(returns: number[]): number | null {
  if (returns.length === 0) return null;
  let cum = 1;
  let peak = 1;
  let peakIdx = 0;
  let maxRecovery = 0;
  let inDrawdown = false;
  for (let i = 0; i < returns.length; i++) {
    cum *= 1 + returns[i]!;
    if (cum >= peak) {
      if (inDrawdown) {
        const recoveryDays = i - peakIdx;
        if (recoveryDays > maxRecovery) maxRecovery = recoveryDays;
        inDrawdown = false;
      }
      peak = cum;
      peakIdx = i;
    } else {
      inDrawdown = true;
    }
  }
  return maxRecovery > 0 ? maxRecovery : null;
}

/** Profit factor = gross gains / gross losses (absolute). */
export function profitFactor(returns: number[]): number | null {
  if (returns.length === 0) return null;
  let gains = 0;
  let losses = 0;
  for (const r of returns) {
    if (r > 0) gains += r;
    else if (r < 0) losses += -r;
  }
  if (losses === 0) return gains > 0 ? Infinity : null;
  return gains / losses;
}

/** Fraction of trades with positive PnL. */
export function winRate(perTradePnl: number[]): number | null {
  if (perTradePnl.length === 0) return null;
  const wins = perTradePnl.filter((p) => p > 0).length;
  return wins / perTradePnl.length;
}

/** Average per-trade PnL. */
export function expectancy(perTradePnl: number[]): number | null {
  if (perTradePnl.length === 0) return null;
  return mean(perTradePnl);
}

/** Sample skewness (Fisher's, biased estimator from simple-statistics). */
export function skewness(values: number[]): number {
  if (values.length < 3) return 0;
  const m = mean(values);
  const sd = sampleStandardDeviation(values);
  if (sd === 0 || !Number.isFinite(sd)) return 0;
  const n = values.length;
  const sum3 = values.reduce((acc, v) => acc + Math.pow((v - m) / sd, 3), 0);
  return sum3 / n;
}

/** Excess kurtosis (Fisher's). */
export function excessKurtosis(values: number[]): number {
  if (values.length < 4) return 0;
  const m = mean(values);
  const sd = sampleStandardDeviation(values);
  if (sd === 0 || !Number.isFinite(sd)) return 0;
  const n = values.length;
  const sum4 = values.reduce((acc, v) => acc + Math.pow((v - m) / sd, 4), 0);
  return sum4 / n - 3;
}
