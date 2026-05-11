const DAYS_PER_MONTH = 365 / 12;
const FULL_CREDIT_MONTHS = 12;

/**
 * Linear track-record weight in [0, 1]: full credit at FULL_CREDIT_MONTHS of
 * observed history, ~1/12 at one month, 0 at zero (or negative / non-finite).
 * Applied to Sharpe & Sortino only — it deliberately keeps the annualization
 * from extrapolating a short hot streak into a full-year figure. The shape may
 * move toward sqrt-scaled after calibration (a later phase).
 */
export function trackRecordMultiplier(daysOfData: number): number {
  if (!Number.isFinite(daysOfData) || daysOfData <= 0) return 0;
  return Math.min(daysOfData / DAYS_PER_MONTH / FULL_CREDIT_MONTHS, 1);
}
