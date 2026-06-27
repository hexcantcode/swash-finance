/**
 * Trader leaderboard, sourced from the Extremely Profitable Hyperdash roster
 * (`ep/roster.ts`) — the single canonical roster shared with the feed and
 * per-trader detail. Replaces the old DB scoring pipeline (`wallets`/`scores`/
 * `fills`) for the list surface.
 *
 * The EP cohort carries no Swash composite score, no account equity, no 30d
 * curve, no heat/winner tags and no live holdings — so the card shape here is
 * deliberately minimal and honest: all-time cohort PnL, win rate, trade count,
 * and the trader's best coin ("alfa") from their top assets.
 */

import { getEpRoster, type EpTopAsset } from '../ep/roster.js';

export type EpLeaderSort = 'pnl' | 'winrate';

export interface EpLeaderCard {
  address: string;
  /** Hyperdash display name (sparse); UI prefers it over the short address. */
  displayName: string | null;
  /** All-time cohort PnL (USD) — NOT a 30d figure. Label it plainly. */
  pnlUsd: number;
  /** 0–100 (already a percentage). */
  winratePct: number;
  totalTrades: number;
  /** The trader's best coin by PnL from `topAssets` — preserves the "alfa
   *  coin" chip. Null when the trader has no top assets. */
  alfaCoin: string | null;
  /** Top 3 assets by PnL (coin + volume + pnl), for richer card display. */
  topAssets: EpTopAsset[];
}

export interface EpLeaderListResult {
  leaders: EpLeaderCard[];
  total: number;
}

/** Best coin by PnL from a trader's top assets. */
function alfaCoin(topAssets: EpTopAsset[]): string | null {
  if (topAssets.length === 0) return null;
  return topAssets.reduce((best, a) => (a.pnlUsd > best.pnlUsd ? a : best)).coin;
}

function toCard(t: Awaited<ReturnType<typeof getEpRoster>>[number]): EpLeaderCard {
  return {
    address: t.address,
    displayName: t.displayName,
    pnlUsd: t.pnlUsd,
    winratePct: t.winratePct,
    totalTrades: t.totalTrades,
    alfaCoin: alfaCoin(t.topAssets),
    topAssets: [...t.topAssets].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(0, 3),
  };
}

/**
 * The trader list (`/api/leaders`). Filters by `search` (address/displayName),
 * sorts by all-time PnL (default) or win rate, then paginates. `total` is the
 * full filtered count (the roster caps at ~80 traders).
 */
export async function listEpLeaders(args: {
  sort: EpLeaderSort;
  search?: string | undefined;
  page: number;
  limit: number;
}): Promise<EpLeaderListResult> {
  const { sort, search, page, limit } = args;
  const roster = await getEpRoster();

  let cards = roster.map(toCard);

  if (search) {
    const q = search.toLowerCase();
    cards = cards.filter(
      (c) =>
        c.address.toLowerCase().includes(q) ||
        (c.displayName?.toLowerCase().includes(q) ?? false),
    );
  }

  cards.sort((a, b) => (sort === 'winrate' ? b.winratePct - a.winratePct : b.pnlUsd - a.pnlUsd));

  const total = cards.length;
  const offset = (page - 1) * limit;
  return { leaders: cards.slice(offset, offset + limit), total };
}

/**
 * The home-screen "Top Traders" strip (`/api/leaders/top`). The EP roster is
 * all-time only, so the rolling `window` (1d/7d/30d) is meaningless here — we
 * sort by all-time `pnlUsd` desc regardless of window and return the top
 * `limit`. The route still echoes the requested window for the UI's tab state.
 */
export async function listEpTopTraders(limit: number): Promise<EpLeaderCard[]> {
  const { leaders } = await listEpLeaders({ sort: 'pnl', page: 1, limit });
  return leaders;
}
