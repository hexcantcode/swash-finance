import { describe, expect, it } from 'vitest';
import { buildDailySeries, toDailyReturns } from './returns.js';

const day = (n: number) => Date.UTC(2026, 0, n);

describe('buildDailySeries', () => {
  it('returns empty for empty inputs', () => {
    const s = buildDailySeries({ fills: [], fundings: [], ledger: [] });
    expect(s.daily).toEqual([]);
    expect(s.netPnl.toString()).toBe('0');
    expect(s.netDeposits.toString()).toBe('0');
    expect(s.activeDays).toBe(0);
    expect(s.firstEventMs).toBeNull();
    expect(s.lastEventMs).toBeNull();
  });

  it('aggregates fills by UTC day, subtracting fees', () => {
    const s = buildDailySeries({
      fills: [
        { blockTimeMs: day(1) + 3_600_000, closedPnl: '100', fee: '5', px: '50', sz: '2' },
        { blockTimeMs: day(1) + 7_200_000, closedPnl: '50', fee: '1', px: '50', sz: '1' },
      ],
      fundings: [],
      ledger: [],
    });
    expect(s.daily).toHaveLength(1);
    expect(s.daily[0]?.dayKey).toBe('2026-01-01');
    expect(s.daily[0]?.pnl.toString()).toBe('144'); // (100 - 5) + (50 - 1)
    expect(s.netPnl.toString()).toBe('144');
  });

  it('puts fills on different days into separate buckets', () => {
    const s = buildDailySeries({
      fills: [
        { blockTimeMs: day(1), closedPnl: '10', fee: '0', px: '1', sz: '1' },
        { blockTimeMs: day(2), closedPnl: '20', fee: '0', px: '1', sz: '1' },
        { blockTimeMs: day(3), closedPnl: '-5', fee: '0', px: '1', sz: '1' },
      ],
      fundings: [],
      ledger: [],
    });
    expect(s.daily).toHaveLength(3);
    expect(s.activeDays).toBe(3);
    expect(s.netPnl.toString()).toBe('25');
  });

  it('adds funding payments to daily PnL', () => {
    const s = buildDailySeries({
      fills: [{ blockTimeMs: day(1), closedPnl: '10', fee: '1', px: '1', sz: '1' }],
      fundings: [{ blockTimeMs: day(1), usdc: '0.5' }],
      ledger: [],
    });
    expect(s.daily[0]?.pnl.toString()).toBe('9.5'); // (10 - 1) + 0.5
  });

  it('separates deposits from PnL — deposits do NOT inflate PnL [CRITICAL]', () => {
    const s = buildDailySeries({
      fills: [{ blockTimeMs: day(2), closedPnl: '50', fee: '0', px: '1', sz: '1' }],
      fundings: [],
      ledger: [
        { blockTimeMs: day(1), type: 'deposit', usdc: '10000' },
        { blockTimeMs: day(3), type: 'withdraw', usdc: '500' },
      ],
    });
    expect(s.netPnl.toString()).toBe('50'); // ONLY the trading PnL
    expect(s.netDeposits.toString()).toBe('9500'); // 10000 in - 500 out
  });

  it('ignores non-deposit/withdraw ledger entries', () => {
    const s = buildDailySeries({
      fills: [],
      fundings: [],
      ledger: [
        { blockTimeMs: day(1), type: 'subAccountTransfer', usdc: '100' },
        { blockTimeMs: day(2), type: 'spotTransfer', usdc: '50' },
      ],
    });
    expect(s.netDeposits.toString()).toBe('0');
  });
});

describe('toDailyReturns', () => {
  it('returns empty array for empty series', () => {
    const s = buildDailySeries({ fills: [], fundings: [], ledger: [] });
    expect(toDailyReturns(s)).toEqual([]);
  });

  it('computes per-day return ratios against initial capital', () => {
    // Deposit on day 1 (same bucket as first fill); deposit lands first in capital.
    const s = buildDailySeries({
      fills: [
        { blockTimeMs: day(1) + 60_000, closedPnl: '100', fee: '0', px: '1', sz: '1' }, // +10% on 1000
        { blockTimeMs: day(2), closedPnl: '-55', fee: '0', px: '1', sz: '1' }, // -5% on 1100
      ],
      fundings: [],
      ledger: [{ blockTimeMs: day(1), type: 'deposit', usdc: '1000' }],
    });
    const r = toDailyReturns(s);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 6);
    expect(r[1]).toBeCloseTo(-0.05, 6);
  });
});
