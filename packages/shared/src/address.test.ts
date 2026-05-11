import { describe, expect, it } from 'vitest';
import {
  InvalidAddressError,
  isAddress,
  normalizeAddress,
  shortAddress,
  tryNormalizeAddress,
} from './address.js';

describe('address', () => {
  const VALID_LOWER = '0xabcdef0123456789abcdef0123456789abcdef01';
  const VALID_MIXED = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
  const TOO_SHORT = '0xabc';
  const NO_PREFIX = 'abcdef0123456789abcdef0123456789abcdef01';
  const BAD_HEX = '0xZZZZef0123456789abcdef0123456789abcdef01';

  describe('isAddress', () => {
    it('accepts canonical lowercase', () => {
      expect(isAddress(VALID_LOWER)).toBe(true);
    });
    it('rejects mixed case (only lowercase is canonical)', () => {
      expect(isAddress(VALID_MIXED)).toBe(false);
    });
    it('rejects too short', () => {
      expect(isAddress(TOO_SHORT)).toBe(false);
    });
    it('rejects without 0x prefix', () => {
      expect(isAddress(NO_PREFIX)).toBe(false);
    });
    it('rejects bad hex chars', () => {
      expect(isAddress(BAD_HEX)).toBe(false);
    });
    it('rejects empty', () => {
      expect(isAddress('')).toBe(false);
    });
  });

  describe('normalizeAddress', () => {
    it('lowercases mixed case', () => {
      expect(normalizeAddress(VALID_MIXED)).toBe(VALID_LOWER);
    });
    it('returns lowercase unchanged', () => {
      expect(normalizeAddress(VALID_LOWER)).toBe(VALID_LOWER);
    });
    it('throws on invalid format', () => {
      expect(() => normalizeAddress(TOO_SHORT)).toThrow(InvalidAddressError);
      expect(() => normalizeAddress(NO_PREFIX)).toThrow(InvalidAddressError);
      expect(() => normalizeAddress(BAD_HEX)).toThrow(InvalidAddressError);
    });
  });

  describe('tryNormalizeAddress', () => {
    it('returns null for null/undefined/empty', () => {
      expect(tryNormalizeAddress(null)).toBeNull();
      expect(tryNormalizeAddress(undefined)).toBeNull();
      expect(tryNormalizeAddress('')).toBeNull();
    });
    it('returns null for invalid', () => {
      expect(tryNormalizeAddress(TOO_SHORT)).toBeNull();
      expect(tryNormalizeAddress(BAD_HEX)).toBeNull();
    });
    it('returns lowercase for valid', () => {
      expect(tryNormalizeAddress(VALID_MIXED)).toBe(VALID_LOWER);
    });
  });

  describe('shortAddress', () => {
    it('elides middle of long address', () => {
      expect(shortAddress(VALID_LOWER)).toBe('0xabcd…ef01');
    });
    it('returns short string unchanged', () => {
      expect(shortAddress('0xabc')).toBe('0xabc');
    });
  });
});
