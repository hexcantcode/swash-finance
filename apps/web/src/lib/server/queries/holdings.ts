import { sql } from 'drizzle-orm';
import { db } from '../db.js';

export interface HoldingSummary {
  coin: string;
  side: 'long' | 'short';
  notionalUsd: number;
}

export interface HoldingsByAddress {
  /** Top N holdings sorted by absolute notional desc, capped at `topPerAddress`. */
  top: HoldingSummary[];
  /** Total open positions for the trader (≥ `top.length`). UI uses
   *  `total − top.length` for the `+N` chip when there's overflow. */
  total: number;
}

/**
 * Fetches each address's currently-open positions from
 * `leader_cache.positions_json` and returns the top-N by absolute notional.
 * One round-trip for the whole address set. Used by the traders-page leader
 * queries (`listTopEarners7d`, `listTopWinRate`, `listLeaders`) to surface
 * a compact Holdings cell — top-3 coin icons + `+N` for any overflow.
 *
 * Sorting by abs(notional) keeps short positions visible alongside longs
 * (the `side` field is preserved so a downstream renderer can color-tint
 * if it wants — current callers don't, just show the coin icon).
 */
export async function listHoldingsByAddress(
  addresses: string[],
  opts: { topPerAddress?: number } = {},
): Promise<Map<string, HoldingsByAddress>> {
  const topPerAddress = opts.topPerAddress ?? 3;
  const result = new Map<string, HoldingsByAddress>();
  if (addresses.length === 0) return result;

  // `node-postgres` won't auto-cast a JS array for `= ANY($n)` here, so
  // build an `IN (...)` list via `sql.join` (same pattern as the other
  // raw-`sql` callers in this directory).
  const addrList = sql.join(
    addresses.map((a) => sql`${a}`),
    sql`, `,
  );
  const rows = await db().execute<{
    address: string;
    coin: string;
    szi: string;
    notional: string;
  }>(sql`
    SELECT
      lc.address,
      (p.elem -> 'position' ->> 'coin')           AS coin,
      (p.elem -> 'position' ->> 'szi')            AS szi,
      (p.elem -> 'position' ->> 'positionValue')  AS notional
    FROM leader_cache lc,
         LATERAL jsonb_array_elements(lc.positions_json) AS p(elem)
    WHERE lc.positions_json IS NOT NULL
      AND lc.address IN (${addrList})
  `);

  const byAddress = new Map<string, HoldingSummary[]>();
  for (const r of rows.rows) {
    const szi = Number.parseFloat(r.szi);
    if (!Number.isFinite(szi) || szi === 0) continue;
    const notional = Math.abs(Number.parseFloat(r.notional));
    if (!Number.isFinite(notional) || notional === 0) continue;

    const list = byAddress.get(r.address) ?? [];
    list.push({
      coin: r.coin,
      side: szi > 0 ? 'long' : 'short',
      notionalUsd: notional,
    });
    byAddress.set(r.address, list);
  }

  for (const [address, list] of byAddress) {
    list.sort((a, b) => b.notionalUsd - a.notionalUsd);
    result.set(address, {
      top: list.slice(0, topPerAddress),
      total: list.length,
    });
  }
  return result;
}
