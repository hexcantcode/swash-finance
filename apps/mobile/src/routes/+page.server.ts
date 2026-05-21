import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Mobile entry point. The leaderboard is the only screen wired up in this
 * slice, so `/` redirects there. When `/assets` and `/feed` land, this can
 * shift to whichever screen is the natural mobile landing.
 *
 * 308 (permanent) so browser history rewrites cleanly. Will be removed
 * when the app switches to adapter-static for the Capacitor build —
 * adapter-static prerenders and can't run a server load on every visit.
 */
export const load: PageServerLoad = () => {
  throw redirect(308, '/traders');
};
