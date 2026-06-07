import { sql, type SQL } from 'drizzle-orm';
import { leaderCache } from './schema.js';

/**
 * `leader_cache.positions_json` is co-owned by multiple writers, each with
 * its own slice of the data:
 *
 *   - `ws-live-subscriber.handleWebData2` — main-dex positions from HL's WS
 *     `webData2` push (hot subset, sub-second latency).
 *   - `leader-cache-poll` — main-dex positions from REST `clearinghouseState
 *     ({user})` (broad 250-wallet coverage, 60 s cadence).
 *   - `ws-live-subscriber.pollHip3ForAddress` / `hip3-poll-subscriber` —
 *     per-HIP-3-dex positions from REST `clearinghouseState({user, dex})`
 *     (5 min cadence, HIP-3 cohort).
 *   - `apps/web` on-demand refresh — main-dex pull on trader-page open for
 *     non-cohort wallets.
 *
 * They share one column, so each writer's `ON CONFLICT DO UPDATE` for
 * `positions_json` must agree on the merge contract. The two helpers below
 * are that contract — every caller goes through them so the contract can't
 * drift between writers.
 */

/**
 * Merge SQL for a writer that owns MAIN-DEX positions (WS push or REST
 * poll). Keeps existing HIP-3 entries (any `coin` containing `:`) from the
 * conflicting row and concatenates the incoming array from
 * `excluded.positions_json`. Without this, a main-dex write would clobber
 * any HIP-3 positions the per-dex poller had written.
 */
export function preserveHip3OnMainWrite(): SQL {
  return sql`(
    coalesce(
      (select jsonb_agg(elem)
       from jsonb_array_elements(${leaderCache.positionsJson}) as elem
       where (elem -> 'position' ->> 'coin') like '%:%'),
      '[]'::jsonb
    )
    || excluded.positions_json
  )`;
}

/**
 * Merge SQL for the HIP-3 dex poller writing positions for a single dex.
 * Drops existing entries whose `coin` starts with `${dexName}:` (the dex
 * being refreshed) and concatenates the incoming array — every entry from
 * other dexes plus main-dex survives. Coin names must be normalized to
 * `${dexName}:SYMBOL` by the caller before insert; the merge depends on
 * that prefix to identify the dex's slice.
 */
export function replaceDexOnHip3Write(dexName: string): SQL {
  const pattern = `${dexName}:%`;
  return sql`(
    coalesce(
      (select jsonb_agg(elem)
       from jsonb_array_elements(${leaderCache.positionsJson}) as elem
       where (elem -> 'position' ->> 'coin') not like ${pattern}),
      '[]'::jsonb
    )
    || excluded.positions_json
  )`;
}
