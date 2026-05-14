import { json } from '@sveltejs/kit';
import { getPositionMatrix } from '$lib/server/queries/analytics';
import type { RequestHandler } from './$types';

/**
 * Lightweight endpoint for the /analytics position matrix to poll on a
 * timer. Same `getPositionMatrix({ tradersLimit: 25, coinsLimit: 30,
 * coinMinHolders: 1 })` call the +page.server.ts load makes.
 *
 * Cost: this is the heaviest of the analytics endpoints. It touches
 * `metaAndAssetCtxs` on HL (weight 20) for volume-ranked coin columns
 * plus a JSONB unpack of every matrix trader's `positions_json`. With
 * HL's 1200 weight/min/IP budget — and `leader-cache-poll` already
 * consuming ~500 weight/min for the broad-cohort REST polls — a 60 s
 * client poll cadence keeps the combined draw at ~700 weight/min,
 * well inside the limit. (The HL client also file-caches
 * `metaAndAssetCtxs` for its TTL, so repeat polls inside the cache
 * window are nearly free.)
 *
 * Matrix data sources update at ≤ 60 s anyway (the worker's
 * leader-cache-poll cadence + per-coin volume rank from HL), so faster
 * polling wouldn't surface meaningfully fresher data.
 */
export const GET: RequestHandler = async () => {
  // Same shape the +page.server.ts load uses — keep them aligned.
  const matrix = await getPositionMatrix({
    tradersLimit: 25,
    coinsLimit: 30,
    coinMinHolders: 1,
  });
  return json({ ok: true, matrix });
};
