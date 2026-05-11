import { type MetricKey, scoreMetric } from './curves.js';

/**
 * Composite scorer (rubric v1.0, derived from spec section 10).
 *
 * Each criterion adds a fixed number of points; the total is clamped to 0..100.
 * Inputs that are null contribute 0 (criterion silently fails).
 */
export interface CompositeInputs {
  psr: number | null;
  dsr: number | null;
  totalTrades: number;
  maxDrawdownPct: number | null;
  profitFactor: number | null;
  makerTakerRatio: number | null;
  avgHoldSeconds: number | null;
  uniqueAssets: number;
  rolling30dSharpe: number | null;
  peakRollingSharpe: number | null;
}

export interface CompositeBreakdown {
  score: number;
  components: Array<{ name: string; points: number; max: number; passed: boolean }>;
}

export function computeComposite(m: CompositeInputs): CompositeBreakdown {
  const components: CompositeBreakdown['components'] = [];

  const add = (name: string, max: number, passed: boolean) => {
    components.push({ name, points: passed ? max : 0, max, passed });
  };

  add('psr_high_with_sample', 25, m.psr !== null && m.psr > 0.95 && m.totalTrades >= 100);
  add('dsr_positive', 15, m.dsr !== null && m.dsr > 0);
  add('drawdown_under_30pct', 10, m.maxDrawdownPct !== null && m.maxDrawdownPct < 0.3);
  add('profit_factor_above_1_5', 10, m.profitFactor !== null && m.profitFactor > 1.5);
  add(
    'maker_taker_balanced',
    10,
    m.makerTakerRatio !== null && m.makerTakerRatio >= 0.2 && m.makerTakerRatio <= 0.7,
  );
  add('avg_hold_above_5min', 10, m.avgHoldSeconds !== null && m.avgHoldSeconds > 300);
  add('diversified_3plus_assets', 10, m.uniqueAssets >= 3);
  add(
    'recent_sharpe_near_peak',
    10,
    m.rolling30dSharpe !== null &&
      m.peakRollingSharpe !== null &&
      m.peakRollingSharpe > 0 &&
      m.rolling30dSharpe >= 0.7 * m.peakRollingSharpe,
  );

  const score = Math.min(
    100,
    Math.max(0, components.reduce((acc, c) => acc + c.points, 0)),
  );
  return { score, components };
}

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
  'expectancy',
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
