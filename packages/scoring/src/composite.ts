import { type MetricKey, scoreMetric } from './curves.js';

/**
 * Decay flag based on the ratio of recent rolling Sharpe to peak.
 *  - green:  ≥ 80% of peak
 *  - yellow: 50–80% of peak
 *  - red:    < 50% of peak (or negative recent)
 */
export function computeDecayFlag(
  recentSharpe: number | null,
  peakSharpe: number | null,
): 'green' | 'yellow' | 'red' | null {
  if (recentSharpe === null || peakSharpe === null || peakSharpe <= 0) return null;
  const ratio = recentSharpe / peakSharpe;
  if (recentSharpe < 0) return 'red';
  if (ratio >= 0.8) return 'green';
  if (ratio >= 0.5) return 'yellow';
  return 'red';
}

export interface MedianCompositeInput {
  metrics: Partial<Record<MetricKey, number | null>>;
  /** Calendar span of the track record: first→last event, in days. */
  daysOfData: number;
}

export interface MedianCompositeResult {
  /** 0..100, rounded, after the confidence cap. */
  score: number;
  /** median of the present sub-scores, before the confidence cap (unrounded). */
  rawScore: number;
  /** min(daysOfData / 90, 1). */
  confidence: number;
  /** daysOfData < 90. */
  provisional: boolean;
  /** one entry per basket metric, in basket order. */
  breakdown: Array<{ key: MetricKey; raw: number | null; score: number | null }>;
}

const CONFIDENCE_FULL_DAYS = 90;

const BASKET: readonly MetricKey[] = [
  'sharpe',
  'sortino',
  'psr',
  'profitFactor',
  'maxDrawdownPct',
  'recoveryTimeDays',
  'monthlyConsistency',
];

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Composite score = median of the normalized metric basket, capped by data
 * sufficiency. Median (not mean) so a single garbage metric can't swing the
 * score; null metrics drop out (e.g. PSR not yet computed). Scores 0 when no
 * metric is present.
 *
 * The confidence cap is on the **calendar span** of the track record
 * (`daysOfData`, first→last event): a short *total history* warrants less
 * trust regardless of how active those days were. (It is deliberately NOT
 * keyed on active-days — an intermittent-but-long-tenured trader shouldn't be
 * penalized for the quiet stretches.)
 */
export function medianComposite(input: MedianCompositeInput): MedianCompositeResult {
  const breakdown = BASKET.map((key) => {
    const raw = input.metrics[key] ?? null;
    return { key, raw, score: scoreMetric(key, raw) };
  });
  const present = breakdown.map((b) => b.score).filter((s): s is number => s !== null);
  const rawScore = median(present);
  const confidence = Math.min(Math.max(input.daysOfData, 0) / CONFIDENCE_FULL_DAYS, 1);
  return {
    score: Math.round(rawScore * confidence),
    rawScore,
    confidence,
    provisional: input.daysOfData < CONFIDENCE_FULL_DAYS,
    breakdown,
  };
}
