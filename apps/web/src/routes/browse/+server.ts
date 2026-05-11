import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// /browse has been merged into the home page (/). Preserve any query params
// (tag/asset/risk/search/sort/page) since the home loader accepts the same ones.
export const GET: RequestHandler = ({ url }) => {
  redirect(308, `/${url.search}`);
};
