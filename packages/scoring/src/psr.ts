import { excessKurtosis, skewness } from './metrics.js';

/**
 * Probabilistic Sharpe Ratio (Bailey & López de Prado, 2012).
 *
 * Probability that the true Sharpe exceeds a benchmark, given that:
 *   - we observed `srObserved` over `nReturns` periods
 *   - the return distribution has skewness γ3 and excess kurtosis γ4
 *
 * Formula:
 *   PSR(SR*) = Φ( (SR̂ - SR*) * sqrt(N - 1) / sqrt(1 - γ3·SR̂ + (γ4/4)·SR̂²) )
 *
 * where Φ is the standard-normal CDF.
 *
 * UNITS — IMPORTANT: `srObserved` (and `benchmarkSr`) MUST be the **per-period
 * (daily) Sharpe** — i.e. `dailySharpe(returns)` from ./metrics, NOT the
 * annualized one. Bailey & López de Prado derive this formula for the
 * non-annualized SR. Feeding it the annualized Sharpe (≈ daily·√365, so ~3–10)
 * blows up the `−γ3·SR̂ + (γ4/4)·SR̂²` term in the denominator and pins Φ(z)
 * at ~1.0 for essentially every wallet. Annualization is purely a display
 * transform; keep it out of PSR.
 *
 * Notes:
 * - The denominator uses excess kurtosis γ4 (subtract 3 from raw kurtosis).
 * - When the denominator inside the sqrt is non-positive (rare with extreme
 *   tails), we return null rather than an imaginary value.
 */
export function probabilisticSharpe(
  returns: number[],
  srObserved: number,
  benchmarkSr = 0,
): number | null {
  if (returns.length < 2) return null;
  if (!Number.isFinite(srObserved)) return null;

  const n = returns.length;
  const g3 = skewness(returns);
  const g4 = excessKurtosis(returns);

  const denomSquared = 1 - g3 * srObserved + (g4 / 4) * srObserved * srObserved;
  if (denomSquared <= 0) return null;

  const denom = Math.sqrt(denomSquared);
  const z = ((srObserved - benchmarkSr) * Math.sqrt(n - 1)) / denom;
  return standardNormalCdf(z);
}

/**
 * Standard-normal cumulative distribution function via Abramowitz & Stegun
 * approximation 26.2.17 (max error ≈ 7.5e-8).
 */
export function standardNormalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d =
    0.3989422804 *
    Math.exp((-x * x) / 2) *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - d : d;
}
