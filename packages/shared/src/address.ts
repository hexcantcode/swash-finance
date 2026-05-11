const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const ADDRESS_RE_CASE_INSENSITIVE = /^0x[a-fA-F0-9]{40}$/;

export type Address = string & { readonly __brand: 'Address' };

export function isAddress(value: string): value is Address {
  return ADDRESS_RE.test(value);
}

export function normalizeAddress(value: string): Address {
  if (!ADDRESS_RE_CASE_INSENSITIVE.test(value)) {
    throw new InvalidAddressError(value);
  }
  return value.toLowerCase() as Address;
}

export function tryNormalizeAddress(value: string | null | undefined): Address | null {
  if (!value) return null;
  if (!ADDRESS_RE_CASE_INSENSITIVE.test(value)) return null;
  return value.toLowerCase() as Address;
}

export class InvalidAddressError extends Error {
  constructor(value: string) {
    super(`Invalid Ethereum address: ${value}`);
    this.name = 'InvalidAddressError';
  }
}

export function shortAddress(addr: string, prefix = 6, suffix = 4): string {
  if (addr.length < prefix + suffix + 2) return addr;
  return `${addr.slice(0, prefix)}…${addr.slice(-suffix)}`;
}
