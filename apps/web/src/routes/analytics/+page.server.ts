import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// /analytics → /feed (renamed). 308 keeps method + body for any deep links
// or bookmarks, and lets search engines transfer ranking.
export const load: PageServerLoad = () => {
  throw redirect(308, '/feed');
};
