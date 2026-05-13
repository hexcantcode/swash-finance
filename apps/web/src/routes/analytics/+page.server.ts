import {
  getLatestFills,
  getPositionMatrix,
  getTopOpenPositions,
} from '$lib/server/queries/analytics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const [latestFills, matrix, topOpenPositions] = await Promise.all([
    getLatestFills(10),
    getPositionMatrix({ tradersLimit: 25, coinsLimit: 18, coinMinHolders: 2 }),
    getTopOpenPositions(25),
  ]);
  return { latestFills, matrix, topOpenPositions };
};
