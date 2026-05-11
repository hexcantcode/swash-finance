import { describe, expect, it } from 'vitest';
import { d, dMax, dMin, dSum } from './decimal.js';

describe('decimal', () => {
  it('preserves precision past float boundary', () => {
    const a = d('0.1');
    const b = d('0.2');
    expect(a.plus(b).toString()).toBe('0.3');
  });

  it('dSum sums an array', () => {
    expect(dSum(['0.1', '0.2', '0.3', '0.4']).toString()).toBe('1');
  });

  it('dSum on empty array returns 0', () => {
    expect(dSum([]).toString()).toBe('0');
  });

  it('dMin / dMax over array', () => {
    expect(dMin(['3', '1', '2', '0.5']).toString()).toBe('0.5');
    expect(dMax(['3', '1', '2', '4.5']).toString()).toBe('4.5');
  });

  it('handles negative values', () => {
    expect(dSum(['-0.5', '0.3', '-0.1']).toString()).toBe('-0.3');
  });
});
