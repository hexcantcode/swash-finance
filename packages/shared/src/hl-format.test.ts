import { describe, expect, it } from 'vitest';
import { formatHlNumber } from './hl-format.js';

describe('formatHlNumber', () => {
  it('strips trailing zeros after the decimal point', () => {
    expect(formatHlNumber('100.0', 4)).toBe('100');
    expect(formatHlNumber('100.10', 4)).toBe('100.1');
    expect(formatHlNumber('100.0000', 4)).toBe('100');
  });

  it('rounds to the requested number of decimals (banker rounding)', () => {
    expect(formatHlNumber('1.23456789', 4)).toBe('1.2346');
    expect(formatHlNumber('1.23455', 4)).toBe('1.2346');
  });

  it('returns "0" for zero values', () => {
    expect(formatHlNumber('0', 4)).toBe('0');
    expect(formatHlNumber('0.00000', 4)).toBe('0');
  });

  it('handles integer values without a decimal point', () => {
    expect(formatHlNumber('1234', 4)).toBe('1234');
  });

  it('handles negative values', () => {
    expect(formatHlNumber('-1.50', 2)).toBe('-1.5');
  });

  it('matches HL "no trailing zero" rule for tiny values', () => {
    expect(formatHlNumber('0.000100', 6)).toBe('0.0001');
  });
});
