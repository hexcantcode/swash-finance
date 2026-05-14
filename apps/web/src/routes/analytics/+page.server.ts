import {
  getCategoryPositionBreakdown,
  getLatestTrades,
  getPositionMatrix,
  getTopOpenPositions,
} from '$lib/server/queries/analytics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const [latestFills, matrix, topOpenPositions, categoryBreakdown] = await Promise.all([
    getLatestTrades(10),
    // Transposed layout (2026-05-14): coins are rows, traders are columns
    // (avatars only). 30 coin rows lets HIP-3 markets (cash:TSLA, xyz:MSTR)
    // make the cut alongside the main-dex majors.
    getPositionMatrix({ tradersLimit: 25, coinsLimit: 30, coinMinHolders: 1 }),
    getTopOpenPositions(25),
    getCategoryPositionBreakdown(),
  ]);
  return { latestFills, matrix, topOpenPositions, categoryBreakdown };
};
