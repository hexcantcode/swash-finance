import type { RequestHandler } from './$types';

// Proxy for HL's coin-icon CDN. Browser hits `/coins/{coin}.svg` instead of
// `app.hyperliquid.xyz/coins/{coin}.svg`; we fetch once per coin per process,
// cache the bytes in memory, and let the browser/edge cache from there via
// long-lived Cache-Control headers.

interface CacheEntry {
  body: ArrayBuffer;
  contentType: string;
  fetchedAt: number;
}

const FRESH_MS = 24 * 60 * 60 * 1000; // serve from memory without refetching
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // keep stale entries as a fallback
const COIN_RE = /^[A-Za-z0-9:_-]{1,40}$/;
const UPSTREAM = 'https://app.hyperliquid.xyz/coins';

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry | null>>();

async function fetchUpstream(coin: string): Promise<CacheEntry | null> {
  const res = await fetch(`${UPSTREAM}/${coin}.svg`, {
    headers: { accept: 'image/svg+xml' },
  });
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') ?? '';
  // HL's SPA returns 200 + text/html for unknown coins (catch-all index.html).
  if (!contentType.includes('image/svg')) return null;
  const body = await res.arrayBuffer();
  return { body, contentType, fetchedAt: Date.now() };
}

async function getOrFetch(coin: string): Promise<CacheEntry | null> {
  const cached = cache.get(coin);
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return cached;

  const existing = inFlight.get(coin);
  if (existing) return existing;

  const p = (async () => {
    try {
      const fresh = await fetchUpstream(coin);
      if (fresh) {
        cache.set(coin, fresh);
        return fresh;
      }
      // Upstream miss / error: fall back to stale entry if we have one in
      // the SWR window, otherwise signal a real miss.
      if (cached && Date.now() - cached.fetchedAt < STALE_MS) return cached;
      return null;
    } catch {
      return cached ?? null;
    } finally {
      inFlight.delete(coin);
    }
  })();

  inFlight.set(coin, p);
  return p;
}

export const GET: RequestHandler = async ({ params }) => {
  const coin = params.coin;
  if (!coin || !COIN_RE.test(coin)) {
    return new Response('not found', { status: 404 });
  }

  const entry = await getOrFetch(coin);
  if (!entry) {
    return new Response('not found', {
      status: 404,
      // Brief negative caching so a broken logo doesn't hammer the upstream
      // every render, but not so long that a newly-listed coin stays broken.
      headers: { 'cache-control': 'public, max-age=300' },
    });
  }

  return new Response(entry.body, {
    headers: {
      'content-type': entry.contentType,
      'cache-control':
        'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
};
