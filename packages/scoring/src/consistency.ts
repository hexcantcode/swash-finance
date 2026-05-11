import { Decimal } from '@copytrade/shared';

export interface DailyPnlRow {
  dayKey: string; // 'YYYY-MM-DD'
  pnl: Decimal;
}

/**
 * Monthly consistency, 0..1. Aggregates daily PnL into calendar months, then
 * scores the fraction of active months that were net non-negative — minus a
 * penalty: any month whose loss magnitude exceeds the single largest winning
 * month costs an extra 1/n (a blow-up roughly cancels a winning month).
 * Months with no activity are not counted either way. Empty input => 0.
 *
 * v1 deliberately simple — calibration (Phase 2) may swap the body for a
 * Sortino-of-monthly-returns or %-above-MAR; the contract is "rows in, 0..1 out".
 */
export function monthlyConsistency(rows: DailyPnlRow[]): number {
  if (rows.length === 0) return 0;
  const byMonth = new Map<string, Decimal>();
  for (const r of rows) {
    const m = r.dayKey.slice(0, 7); // 'YYYY-MM'
    byMonth.set(m, (byMonth.get(m) ?? new Decimal(0)).plus(r.pnl));
  }
  const monthly = [...byMonth.values()];
  const n = monthly.length;
  const wins = monthly.filter((v) => v.gte(0)).length;
  const base = wins / n;
  const maxWin = monthly
    .filter((v) => v.gt(0))
    .reduce<Decimal>((mx, v) => (v.gt(mx) ? v : mx), new Decimal(0));
  const blowups = monthly.filter((v) => v.lt(0) && v.abs().gt(maxWin)).length;
  return Math.max(0, base - blowups / n);
}
