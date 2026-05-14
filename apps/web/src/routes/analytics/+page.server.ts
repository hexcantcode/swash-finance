import {
  getLatestFills,
  getPositionMatrix,
  getTopOpenPositions,
} from '$lib/server/queries/analytics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const [latestFills, matrix, topOpenPositions] = await Promise.all([
    getLatestFills(10),
    // Intersection mode (per user direction 2026-05-14): rank columns by HL
    // 24h volume, but drop coins no tracked trader holds — so the matrix is
    // dense-ish but the volume-headline names lead.
    getPositionMatrix({ tradersLimit: 25, coinsLimit: 18, coinMinHolders: 1 }),
    getTopOpenPositions(25),
  ]);
  return { latestFills, matrix, topOpenPositions };
};
