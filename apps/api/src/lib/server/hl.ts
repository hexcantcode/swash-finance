import { HlInfoClient } from '@copytrade/hl-client';

let _hl: HlInfoClient | null = null;

export function hl(): HlInfoClient {
  if (_hl) return _hl;
  // No on-disk cache for the server (multiple instances on Railway).
  // Cache lives in DB (leader_cache) for cross-instance consistency.
  _hl = new HlInfoClient({});
  return _hl;
}
