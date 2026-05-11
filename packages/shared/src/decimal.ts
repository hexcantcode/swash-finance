import Decimal from 'decimal.js';

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -1000,
  toExpPos: 1000,
});

export { Decimal };

export function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function dSum(values: ReadonlyArray<Decimal.Value>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

export function dMin(values: ReadonlyArray<Decimal.Value>): Decimal {
  if (values.length === 0) return new Decimal(0);
  let min = new Decimal(values[0]!);
  for (let i = 1; i < values.length; i++) {
    const candidate = new Decimal(values[i]!);
    if (candidate.lt(min)) min = candidate;
  }
  return min;
}

export function dMax(values: ReadonlyArray<Decimal.Value>): Decimal {
  if (values.length === 0) return new Decimal(0);
  let max = new Decimal(values[0]!);
  for (let i = 1; i < values.length; i++) {
    const candidate = new Decimal(values[i]!);
    if (candidate.gt(max)) max = candidate;
  }
  return max;
}

export function decimalToNumber(value: Decimal): number {
  return value.toNumber();
}

export function decimalToString(value: Decimal): string {
  return value.toString();
}

export function isFiniteDecimal(value: Decimal): boolean {
  return value.isFinite();
}
