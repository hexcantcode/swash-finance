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
