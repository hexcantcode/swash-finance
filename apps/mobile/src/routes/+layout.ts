// SPA mode for the Capacitor build + static PWA host: no SSR, nothing
// prerendered. Every screen is client-rendered and fetches from the BFF
// (/api/*) — replaces the old client-only +page.server.ts stubs and the
// no-op +layout.server.ts.
export const ssr = false;
export const prerender = false;
