import { asc, desc, eq } from 'drizzle-orm';
import { scores, wallets } from '@copytrade/db';
import { db } from '../db.js';

export interface WeeklyLeaderRow {
  address: string;
  primary_tag: string | null;
  composite_score: number | null;
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
}

/**
 * The "Winners" cards: the canonical winner set — `wallets.winner` — which the
 * `leaderboard-poll` job computes as HL's top-10 by 7d ROI passing the noise
 * filter (account value ≥ $10K, 7d volume ≥ $100K, ROI sanity). One source of
 * truth: this is the same set the live-WS subscriber tracks; `wallets.winner` /
 * `wallets.winnerRank` are owned by `leaderboard-poll`, and the HL 7d numbers
 * (`hlRoi7d` / `hlPnl7dUsd` / `hlVolume7dUsd`) by that same job's upsert.
 *
 * Cards are ordered by **composite score** (desc) — so the highest-quality of
 * the hot-this-week traders leads — not by raw 7d ROI. Left-joins `scores` for
 * win rate / Sharpe / Sortino; a winner that just entered the set and hasn't
 * been ingested+scored yet shows `—` for those until the next score run.
 */
export async function listTopByWeeklyRoi(limit = 10): Promise<WeeklyLeaderRow[]> {
  const rows = await db()
    .select({
      address: wallets.address,
      primary_tag: wallets.primaryTag,
      composite_score: wallets.compositeScore,
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
    .orderBy(desc(wallets.compositeScore), asc(wallets.winnerRank))
    .limit(limit);

  return rows.map((r) => ({
    address: r.address,
    primary_tag: r.primary_tag,
    composite_score: r.composite_score,
    winner_rank: r.winner_rank,
    win_rate: numOrNull(r.win_rate),
    sharpe: numOrNull(r.sharpe),
    sortino: numOrNull(r.sortino),
    roi_7d: numOrNull(r.roi_7d),
    pnl_7d_usd: numOrNull(r.pnl_7d_usd),
    volume_7d_usd: numOrNull(r.volume_7d_usd),
    account_value_usd: numOrNull(r.account_value_usd),
    last_active_at: r.last_active_at?.toISOString() ?? null,
  }));
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
