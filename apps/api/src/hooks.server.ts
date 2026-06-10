import type { Handle } from '@sveltejs/kit';

/**
 * CORS for the BFF.
 *
 * apps/api is a backend the mobile client calls. In the PWA (same-origin) it
 * never exercises CORS, but the Capacitor native build is cross-origin — its
 * requests come from `capacitor://localhost` / `http://localhost` against the
 * deployed API. Baking CORS in now means the native flip isn't a surprise.
 *
 * The API is public, read-only data with no cookie sessions (auth, when added,
 * is a bearer token — see docs/plans/2026-06-10-mobile-architecture-design.md),
 * so echoing the request Origin is safe and maximally compatible. Only the
 * data-bearing surfaces (`/api`, `/coins`) get the headers.
 */
const CORS_PREFIXES = ['/api', '/coins'];

function corsHeaders(request: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': request.headers.get('origin') ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export const handle: Handle = async ({ event, resolve }) => {
  const isCors = CORS_PREFIXES.some((p) => event.url.pathname.startsWith(p));

  // Preflight — answer before hitting any route.
  if (isCors && event.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(event.request) });
  }

  const response = await resolve(event);
  if (isCors) {
    for (const [key, value] of Object.entries(corsHeaders(event.request))) {
      response.headers.set(key, value);
    }
  }
  return response;
};
