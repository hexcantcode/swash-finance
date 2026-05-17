import { asc, eq } from 'drizzle-orm';
import { scores, wallets } from '@copytrade/db';
import { db } from '../db.js';
import { listBestAssetsByWinRate } from './best-asset.js';
import { listHoldingsByAddress, type HoldingsByAddress } from './holdings.js';

export interface WeeklyLeaderRow {
  address: string;
  primary_tag: string | null;
  score: number | null;
  win_rate: number | null;
  sharpe: number | null;
  sortino: number | null;
  /** 1..N position by HL 7d ROI inside the winner set (cards are ordered by composite, not this). */
  winner_rank: number | null;
  roi_7d: number | null;
  pnl_7d_usd: number | null;
  volume_7d_usd: number | null;
  account_value_usd: number | null;
  last_active_at: string | null;
  /** "Alfa" — coin this trader has the highest fill-level win rate on with
   *  ≥ 5 trades on that coin. Null when no coin clears the sample floor. */
  alfa_coin: string | null;
  /** Currently-open positions snapshot — top 3 by notional + total count.
   *  Drives the Holdings cell on the traders page. Empty top + total=0 when
   *  the wallet has no open positions in `leader_cache`. */
  holdings: HoldingsByAddress;
}

/**
 * The "Top Earners" cards: the canonical winner set — `wallets.winner` — which
 * `leaderboard-poll` populates as HL's top-10 by **7d realized PnL** passing
 * the noise filter (account value ≥ MIN_ACCOUNT_VALUE_USD ($25K), 7d volume ≥
 * $100K, |ROI| ≤ 50). One source of truth: this is the same set the live-WS
 * subscriber tracks; `wallets.winner` / `wallets.winnerRank` are owned by
 * `leaderboard-poll`, and the HL 7d numbers (`hlPnl7dUsd` / `hlRoi7d` /
 * `hlVolume7dUsd`) by that same job's upsert.
 *
 * Cards are ordered by **`winner_rank` asc** — which by construction is 7d
 * PnL desc — so Loracle ($14M) leads, not the small-account 90%-ROI traders
 * who'd top a ROI-sorted list but only earned a fraction of the absolute PnL.
 * Left-joins `scores` for the analyzed-tier metrics; winners that haven't
 * been deep-ingested yet show `—` for those until the next score run.
 */
export async function listTopEarners7d(limit = 10): Promise<WeeklyLeaderRow[]> {
  const rows = await db()
    .select({
      address: wallets.address,
      primary_tag: wallets.primaryTag,
      score: wallets.score,
      winner_rank: wallets.winnerRank,
      win_rate: scores.winRate,
      sharpe: scores.sharpe,
      sortino: scores.sortino,
      roi_7d: wallets.hlRoi7d,
      pnl_7d_usd: wallets.hlPnl7dUsd,
      volume_7d_usd: wallets.hlVolume7dUsd,
      account_value_usd: wallets.accountValue,
      last_active_at: scores.lastTradeAt,
    })
    .from(wallets)
    .leftJoin(scores, eq(scores.address, wallets.address))
    .where(eq(wallets.winner, true))
    .orderBy(asc(wallets.winnerRank))
    .limit(limit);

  // NOTE: deliberately NOT joining `tracked_wallets` here. Winners is a
  // discovery surface — it shows newly-trending top-PnL wallets that may
  // not be scored yet (`tracked_wallets` requires a score). Live-equity
  // safety is enforced upstream by `leaderboard-poll.filterWinnersByLiveEquity`
  // before `wallets.winner` is ever set. See
  // docs/plans/2026-05-17-tracked-wallets-view-design.md.

  const addresses = rows.map((r) => r.address);
  const [alfaByAddress, holdingsByAddress] = await Promise.all([
    listBestAssetsByWinRate(addresses),
    listHoldingsByAddress(addresses),
  ]);

  return rows.map((r) => ({
    address: r.address,
    primary_tag: r.primary_tag,
    score: r.score,
    winner_rank: r.winner_rank,
    win_rate: numOrNull(r.win_rate),
    sharpe: numOrNull(r.sharpe),
    sortino: numOrNull(r.sortino),
    roi_7d: numOrNull(r.roi_7d),
    pnl_7d_usd: numOrNull(r.pnl_7d_usd),
    volume_7d_usd: numOrNull(r.volume_7d_usd),
    account_value_usd: numOrNull(r.account_value_usd),
    last_active_at: r.last_active_at?.toISOString() ?? null,
    alfa_coin: alfaByAddress.get(r.address) ?? null,
    holdings: holdingsByAddress.get(r.address) ?? { top: [], total: 0 },
  }));
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
