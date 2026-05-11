import { Decimal } from './decimal.js';

/**
 * Format a numeric value for Hyperliquid order placement.
 * HL rejects strings with trailing zeros (e.g. "100.0"); this strips them
 * after rounding to the asset's szDecimals or tickSize.
 */
export function formatHlNumber(value: Decimal.Value, decimals: number): string {
  const rounded = new Decimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN);
  return rounded.toString();
}

export function formatHlPrice(value: Decimal.Value, tickSizeDecimals: number): string {
  return formatHlNumber(value, tickSizeDecimals);
}

export function formatHlSize(value: Decimal.Value, szDecimals: number): string {
  return formatHlNumber(value, szDecimals);
}
