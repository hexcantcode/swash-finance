import {
  getCategoryPositionBreakdown,
  getLatestTradesByCategory,
  getMostHeldByCategory,
  getPositionMatrix,
  getTopOpenPositionsByCategory,
} from '$lib/server/queries/analytics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const [latestFills, matrix, topOpenPositions, categoryBreakdown, mostHeld] = await Promise.all([
    // Latest trades + Winning Trades now render as a 2×2 grid (stocks left,
    // crypto right). Server pre-splits by category — same `coinCategory`
    // logic the sentiment cards use — so each panel renders directly without
    // a client-side reclassify.
    getLatestTradesByCategory({ perCategory: 10 }),
    // Transposed layout (2026-05-14): coins are rows, traders are columns
    // (avatars only). 30 coin rows lets HIP-3 markets (cash:TSLA, xyz:MSTR)
    // make the cut alongside the main-dex majors.
    getPositionMatrix({ tradersLimit: 25, coinsLimit: 30, coinMinHolders: 1 }),
    getTopOpenPositionsByCategory({ perCategory: 10 }),
    getCategoryPositionBreakdown(),
    // "Most Held" coins panel — 5 per category, ranked by distinct tracked
    // traders holding an open position. Sits between sentiment + the
    // trades panels.
    getMostHeldByCategory({ perCategory: 5 }),
  ]);
  return { latestFills, matrix, topOpenPositions, categoryBreakdown, mostHeld };
};
