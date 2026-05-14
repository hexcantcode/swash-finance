import { inArray, sql } from 'drizzle-orm';
import { fills } from '@copytrade/db';
import { db } from '../db.js';
import { resolveCoins } from '../spot-aliases';

/**
 * For each input address, the coin they "trade best" — defined as the coin
 * with the highest fill-level win rate (`(closedPnl − fee) > 0`), subject to
 * a minimum sample-size floor on that coin. Ties are broken by sample size
 * so a 100% rate on 5 trades loses to a 90% rate on 50 trades when both
 * round to the same headline value.
 *
 * Win-rate semantics match `scores.winRate` (per-fill, not per-round-trip)
 * — same definition used by the Win Rate top-5 ranking, so the Alfa column
 * stays consistent with the rest of the analytics page.
 *
 * **Coin name normalization.** HL stores some coin names in raw-index form:
 *   - `@N` — main-dex spot pair (e.g. `@107` = `HYPE/USDC`). We resolve
 *     these via `resolveCoins()` to the base token symbol (`HYPE`).
 *   - `#N` — HIP-3 spot pair on a builder dex (e.g. `#250`). HL doesn't
 *     expose these names in any public meta endpoint, so we filter them
 *     out as ALFA candidates entirely — surfacing `#250` to a user
 *     reading the leaderboard adds no signal. The trader's next-best
 *     coin takes the slot instead.
 *
 * Returns a `Map<address, coin>`. Addresses that have no coin clearing the
 * `minTrades` floor are absent from the map; callers should treat that as
 * "no Alfa" and render `—`.
 */
export async function listBestAssetsByWinRate(
  addresses: string[],
  opts: { minTrades?: number } = {},
): Promise<Map<string, string>> {
  const minTrades = opts.minTrades ?? 5;
  const result = new Map<string, string>();
  if (addresses.length === 0) return result;

  const rows = await db()
    .select({
      address: fills.userAddress,
      coin: fills.coin,
      wins: sql<string>`count(*) filter (where ${fills.closedPnl}::numeric - ${fills.fee}::numeric > 0)`,
      samples: sql<string>`count(*)`,
    })
    .from(fills)
    .where(inArray(fills.userAddress, addresses))
    .groupBy(fills.userAddress, fills.coin)
    .having(sql`count(*) >= ${minTrades}`);

  // Pick the winning coin per address in JS — Drizzle has no DISTINCT ON, and
  // the per-address group set is small (typically ≤100 rows total since we
  // already filter to known address list). Tie-break: higher sample size wins
  // when win-rates are equal, so a small-sample lucky run can't beat a longer
  // record at the same headline rate.
  type Best = { coin: string; winRate: number; samples: number };
  const bestByAddress = new Map<string, Best>();
  for (const r of rows) {
    // Skip HIP-3 spot pair indices (`#250`, `#0`, …) — HL doesn't expose
    // their friendly names anywhere, so we'd render an opaque `#N` to the
    // user. The trader's next-best coin clearing `minTrades` wins the slot.
    if (r.coin.startsWith('#')) continue;
    const wins = Number.parseInt(r.wins, 10);
    const samples = Number.parseInt(r.samples, 10);
    if (!Number.isFinite(samples) || samples < minTrades) continue;
    const winRate = wins / samples;
    const current = bestByAddress.get(r.address);
    if (
      current === undefined ||
      winRate > current.winRate ||
      (winRate === current.winRate && samples > current.samples)
    ) {
      bestByAddress.set(r.address, { coin: r.coin, winRate, samples });
    }
  }
  // Resolve `@N` → friendly base-token names in one batched spotMeta lookup
  // (the resolver caches + skips the HL fetch when no `@`-prefixed coins
  // are present).
  const addrs = Array.from(bestByAddress.keys());
  const raws = addrs.map((a) => bestByAddress.get(a)!.coin);
  const resolved = await resolveCoins(raws);
  for (let i = 0; i < addrs.length; i++) {
    result.set(addrs[i]!, resolved[i]!);
  }
  return result;
}
