import { probabilisticSharpe, standardNormalInverseCdf } from './psr.js';

const EULER_MASCHERONI = 0.5772156649015329;

/**
 * Deflated Sharpe Ratio (López de Prado, 2018).
 *
 * Adjusts PSR for selection bias (multiple testing). When you screen many
 * candidates and pick the best, the highest observed SR overstates the true
 * SR. DSR shifts the benchmark up to compensate.
 *
 * Adjusted benchmark Sharpe:
 *   SR* = sqrt(V[SR_estimates]) * { (1−γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)) }
 *
 * where:
 *   N = number of independent trials
 *   γ = Euler-Mascheroni constant
 *   V[SR_estimates] = variance of SR across trials (annualized)
 *
 * Then DSR = PSR(SR*).
 *
 * For practical use we accept `srVariance` as a parameter; the worker computes
 * it across the population of scored wallets in J-1.
 */
export function deflatedSharpe(
  returns: number[],
  srObserved: number,
  args: { trialCount: number; srVariance: number },
): number | null {
  if (args.trialCount < 1) return null;
  if (!Number.isFinite(srObserved)) return null;
  if (args.srVariance < 0 || !Number.isFinite(args.srVariance)) return null;

  const adjustedBenchmark = adjustedBenchmarkSharpe(args.trialCount, args.srVariance);
  if (!Number.isFinite(adjustedBenchmark)) return null;

  return probabilisticSharpe(returns, srObserved, adjustedBenchmark);
}

/** The bias-corrected benchmark Sharpe used inside DSR. Public for testing. */
export function adjustedBenchmarkSharpe(trialCount: number, srVariance: number): number {
  const sd = Math.sqrt(Math.max(srVariance, 0));
  if (trialCount <= 1) return sd * standardNormalInverseCdf(1 - 1 / Math.E);
  const term1 = (1 - EULER_MASCHERONI) * standardNormalInverseCdf(1 - 1 / trialCount);
  const term2 = EULER_MASCHERONI * standardNormalInverseCdf(1 - 1 / (trialCount * Math.E));
  return sd * (term1 + term2);
}
