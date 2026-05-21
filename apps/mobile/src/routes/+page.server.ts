/** Home screen is loaded client-side (top traders, featured markets, assets
 *  table all come from apps/web's /api/*). Stub stays so SvelteKit treats `/`
 *  as having no server load — same client-only pattern as the other screens. */
export const prerender = false;
