import { json } from '@sveltejs/kit';
import { tryNormalizeAddress } from '@copytrade/shared';
import { listHoldingsByAddress } from '$lib/server/queries/holdings';
import type { RequestHandler } from './$types';

const MAX_ADDRESSES = 200;

// Batch holdings refresh for the /traders page. Returns the same
// `HoldingsByAddress` shape the loaders use, keyed by address — so client
// code can patch row-by-row without translating between representations.
export const GET: RequestHandler = async ({ url }) => {
  // Accept either repeated `?address=0x…&address=0x…` or a single
  // `?addresses=0x…,0x…` comma list; mini-tables and the main table both
  // need to call this, and a query-string array keeps the call URL-cache-
  // friendly for SvelteKit's HTTP cache.
  const raw = [...url.searchParams.getAll('address'), ...(url.searchParams.get('addresses')?.split(',') ?? [])];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const r of raw) {
    const a = tryNormalizeAddress(r);
    if (!a || seen.has(a)) continue;
    seen.add(a);
    normalized.push(a);
    if (normalized.length >= MAX_ADDRESSES) break;
  }

  if (normalized.length === 0) return json({});

  const map = await listHoldingsByAddress(normalized);
  const out: Record<string, ReturnType<typeof map.get>> = {};
  for (const a of normalized) {
    out[a] = map.get(a) ?? { top: [], total: 0 };
  }
  return json(out);
};
