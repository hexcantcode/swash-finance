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

/** Inverse standard-normal CDF (probit). Beasley-Springer-Moro algorithm. */
export function standardNormalInverseCdf(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return Number.NaN;
  }
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const dCoeffs = [7.784695709041462e-3, 3.224671290700398e-1,
    2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((dCoeffs[0]! * q + dCoeffs[1]!) * q + dCoeffs[2]!) * q + dCoeffs[3]!) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((dCoeffs[0]! * q + dCoeffs[1]!) * q + dCoeffs[2]!) * q + dCoeffs[3]!) * q + 1);
}
