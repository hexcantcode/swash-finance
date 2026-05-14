import { inArray, sql } from 'drizzle-orm';
import { fills } from '@copytrade/db';
import { db } from '../db.js';

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
  for (const [addr, best] of bestByAddress) result.set(addr, best.coin);
  return result;
}
