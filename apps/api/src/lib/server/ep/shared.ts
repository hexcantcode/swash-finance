/**
 * Shared Hyperdash transport for the EP (Extremely Profitable) cohort module.
 *
 * All EP data — roster, positions, trades, sentiment, per-trader detail — comes
 * from Hyperdash's public GraphQL. This is the single place that owns the URL,
 * the browser-UA headers (the endpoint blocks default fetch/curl agents), and
 * the POST + GraphQL-error handling. Everything else in `ep/` calls `hdFetch`.
 *
 * See the `.claude/skills/hyperdash-top-traders` skill for endpoint provenance.
 */

export const HYPERDASH_GRAPHQL = 'https://api.hyperdash.com/graphql';

// A browser UA is required — the endpoint blocks default fetch/curl agents.
export const HD_HEADERS = {
  'content-type': 'application/json',
  origin: 'https://hyperdash.com',
  referer: 'https://hyperdash.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

/**
 * POST a GraphQL operation to Hyperdash. Throws on a non-ok HTTP status or any
 * GraphQL errors; returns `json.data` (typed by the caller). Callers decide how
 * to recover (e.g. serve last-good from `ttlCache`).
 */
export async function hdFetch<T>(
  operationName: string,
  query: string,
  variables?: unknown,
): Promise<T> {
  const res = await fetch(HYPERDASH_GRAPHQL, {
    method: 'POST',
    headers: HD_HEADERS,
    body: JSON.stringify({ operationName, query, variables }),
  });
  if (!res.ok) throw new Error(`hyperdash ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  const err = json.errors?.[0];
  if (err) throw new Error(`hyperdash graphql: ${err.message}`);
  return json.data as T;
}

/**
 * Tiny TTL cache capturing the duplicated `{ at, data }` + serve-last-good
 * pattern. `get()` returns the cached value while fresh; `set()` stores a new
 * value; `last()` returns the last stored value regardless of age (for the
 * fallback path when upstream blips).
 */
export function ttlCache<T>(ttlMs: number) {
  let entry: { at: number; data: T } | null = null;
  return {
    get(): T | null {
      if (entry && Date.now() - entry.at < ttlMs) return entry.data;
      return null;
    },
    set(data: T): T {
      entry = { at: Date.now(), data };
      return data;
    },
    last(): T | null {
      return entry?.data ?? null;
    },
  };
}
