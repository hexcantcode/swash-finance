import { HlInfoClient } from '@copytrade/hl-client';
import { cacheDir, env } from './env.js';

let _hl: HlInfoClient | null = null;

export function hl(): HlInfoClient {
  if (_hl) return _hl;
  _hl = new HlInfoClient({
    cacheDir: cacheDir(),
    defaultCacheTtlSeconds: env().HL_CACHE_TTL_SECONDS,
  });
  return _hl;
}
