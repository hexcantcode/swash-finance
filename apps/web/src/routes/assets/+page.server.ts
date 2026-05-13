import { listAssets } from '$lib/server/queries/assets';
import { listRecentTrades } from '$lib/server/queries/recent-trades';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const [assets, recentTrades] = await Promise.all([listAssets(), listRecentTrades(40)]);
  const byVolume = [...assets].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  const withChange = assets.filter((a) => a.change24h !== null);
  const winners = [...withChange]
    .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    .slice(0, 5);
  const losers = [...withChange]
    .sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0))
    .slice(0, 5);
  return { assets: byVolume, winners, losers, recentTrades };
};
