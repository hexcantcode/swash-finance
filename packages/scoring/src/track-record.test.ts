import { describe, it, expect } from 'vitest';
import { trackRecordMultiplier } from './track-record.js';

describe('trackRecordMultiplier', () => {
  it('full credit at >= 12 months', () => {
    expect(trackRecordMultiplier(365)).toBeCloseTo(1, 10);
    expect(trackRecordMultiplier(800)).toBeCloseTo(1, 10); // clamped
  });
  it('linear in months below a year', () => {
    expect(trackRecordMultiplier(365 / 12)).toBeCloseTo(1 / 12, 6);   // ~1 month
    expect(trackRecordMultiplier(365 / 2)).toBeCloseTo(0.5, 6);       // ~6 months
  });
  it('0 for no / negative / non-finite data', () => {
    expect(trackRecordMultiplier(0)).toBe(0);
    expect(trackRecordMultiplier(-10)).toBe(0);
    expect(trackRecordMultiplier(NaN)).toBe(0);
  });
});
