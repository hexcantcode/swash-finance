import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * `/` is now an alias for `/assets`, the product entry point. The old
 * leaderboard-home content moved to `/traders/+page.{server.ts,svelte}`.
 * 308 (permanent) so search engines + browser history rewrite cleanly.
 */
export const load: PageServerLoad = () => {
  throw redirect(308, '/assets');
};
