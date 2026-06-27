import { hl } from './hl';

/**
 * HL fills/positions for spot trades come back with `coin: "@<index>"` — the
 * internal universe-pair identifier (e.g. `@107` = `HYPE/USDC`, `@234` =
 * `UBTC/USDH`, `@151` = `UETH/USDC`). The string `@107` is opaque to a user
 * looking at the analytics page; we want to render the base token name.
 *
 * `resolveCoin('@107')` → `'HYPE'`. Non-`@`-prefixed coins (every perp + every
 * HIP-3 `dex:SYMBOL`) pass through unchanged.
 *
 * Map is built from `hl().spotMeta()`:
 *   - `universe[i]` has `name: "@N"` and `tokens: [baseIdx, quoteIdx]`.
 *   - `tokens[baseIdx]` has the human-readable `name` (e.g. `"HYPE"`).
 *
 * Cached in-memory for 10 minutes — spot pairs change rarely and the call is
 * weight-20 on HL, so the analytics page polls (10 s / 20 s / 60 s cadences)
 * would otherwise burn budget here on every cycle. First call after expiry
 * blocks for ~50 ms; subsequent calls inside the TTL are O(1) map lookups.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: Map<string, string> = new Map();
let fetchedAt = 0;
let inFlight: Promise<Map<string, string>> | null = null;

async function loadAliasMap(): Promise<Map<string, string>> {
  const fresh = new Map<string, string>();
  const res = await hl().spotMeta();
  const universe = res.data.universe;
  const tokens = res.data.tokens;
  for (const u of universe) {
    // `u.name` is the `@N` string we want to map; `u.tokens` is `[baseIdx, quoteIdx]`.
    const baseIdx = u.tokens?.[0];
    if (typeof baseIdx !== 'number') continue;
    const base = tokens[baseIdx];
    if (!base?.name) continue;
    fresh.set(u.name, base.name);
  }
  cache = fresh;
  fetchedAt = Date.now();
  return fresh;
}

async function ensureMap(): Promise<Map<string, string>> {
  if (cache.size > 0 && Date.now() - fetchedAt < CACHE_TTL_MS) return cache;
  // Coalesce concurrent refreshes so multiple poll endpoints firing at the
  // same time don't issue parallel `spotMeta` calls.
  if (inFlight) return inFlight;
  inFlight = loadAliasMap().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Resolve a coin string. `@N` → base token name from spotMeta; everything
 * else returns unchanged. The map is warmed lazily — caller must `await` it.
 */
export async function resolveCoin(coin: string): Promise<string> {
  if (!coin.startsWith('@')) return coin;
  const map = await ensureMap();
  return map.get(coin) ?? coin;
}

/**
 * Resolve a batch of coins in one cache warm. Pass any mix of `@N` and
 * normal coin strings; returns a parallel array of resolved names.
 */
export async function resolveCoins(coins: string[]): Promise<string[]> {
  // Fast-path: if no `@`-prefixed coins, skip the map fetch entirely.
  if (!coins.some((c) => c.startsWith('@'))) return coins;
  const map = await ensureMap();
  return coins.map((c) => (c.startsWith('@') ? (map.get(c) ?? c) : c));
}
