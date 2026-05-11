import { describe, it, expect } from 'vitest';
import { d } from '@copytrade/shared';
import { monthlyConsistency } from './consistency.js';

const day = (dayKey: string, pnl: number) => ({ dayKey, pnl: d(pnl) });

describe('monthlyConsistency', () => {
  it('all profitable months => 1', () => {
    expect(monthlyConsistency([day('2025-01-05', 100), day('2025-02-10', 50), day('2025-03-01', 10)])).toBe(1);
  });
  it('half the months losing => ~0.5', () => {
    expect(monthlyConsistency([day('2025-01-05', 100), day('2025-02-10', -50)])).toBeCloseTo(0.5, 5);
  });
  it('a catastrophic month is penalised below a milder loss month', () => {
    const mild  = monthlyConsistency([day('2025-01-05', 100), day('2025-02-10', 100), day('2025-03-01', -5)]);
    const harsh = monthlyConsistency([day('2025-01-05', 100), day('2025-02-10', 100), day('2025-03-01', -10_000)]);
    expect(harsh).toBeLessThan(mild);
  });
  it('aggregates days within a month before judging the month', () => {
    // Jan: +100 then -30 => net +70 => a winning month
    expect(monthlyConsistency([day('2025-01-03', 100), day('2025-01-20', -30)])).toBe(1);
  });
  it('empty input => 0', () => { expect(monthlyConsistency([])).toBe(0); });
});
