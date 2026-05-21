/**
 * Mobile /traders is loaded client-side — the page fetches /api/leaders from
 * apps/web via the Vite proxy (dev) or PUBLIC_API_BASE (Capacitor build).
 * This stub stays so SvelteKit treats the route as having no server load,
 * not so it can run server-side data fetching. Will be deleted entirely
 * when the app switches to adapter-static.
 */
export const prerender = false;
