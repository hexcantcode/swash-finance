import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { scores, wallets } from '@copytrade/db';
import { db } from '../db.js';

export interface WeeklyLeaderRow {
  address: string;
  primary_tag: string | null;
  composite_score: number | null;
  win_rate: number | null;
  sharpe: number | null;
  roi_7d: number | null;
  pnl_7d_usd: number | null;
  volume_7d_usd: number | null;
  account_value_usd: number | null;
  last_active_at: string | null;
}

/** Eligibility floor for the 7d view: ignore wallets whose week-window
 *  volume is too small to give the ROI any signal. */
const MIN_WEEKLY_VOLUME_USD = 5_000;

/**
 * Top traders ranked by HL's official 7-day ROI. The ROI is HL's native
 * pnl/account_value calculation (already in decimal: 0.05 = 5%).
 *
 * Skips wallets without an hl_metrics_at (means we haven't ingested their
 * leaderboard row yet) and wallets with tiny 7d volume. Left-joins the scores
 * table so the cards can show win rate / Sharpe alongside the 7d numbers.
 */
export async function listTopByWeeklyRoi(limit = 10): Promise<WeeklyLeaderRow[]> {
  const rows = await db()
    .select({
      address: wallets.address,
      primary_tag: wallets.primaryTag,
      composite_score: wallets.compositeScore,
      win_rate: scores.winRate,
      sharpe: scores.sharpe,
      roi_7d: wallets.hlRoi7d,
      pnl_7d_usd: wallets.hlPnl7dUsd,
      volume_7d_usd: wallets.hlVolume7dUsd,
      account_value_usd: wallets.accountValue,
      last_active_at: wallets.lastSeenAt,
    })
    .from(wallets)
    .leftJoin(scores, eq(scores.address, wallets.address))
    .where(
      and(
        isNotNull(wallets.hlRoi7d),
        gte(wallets.hlVolume7dUsd, sql`${MIN_WEEKLY_VOLUME_USD}::numeric`),
      ),
    )
    .orderBy(desc(wallets.hlRoi7d))
    .limit(limit);

  return rows.map((r) => ({
    address: r.address,
    primary_tag: r.primary_tag,
    composite_score: r.composite_score,
    win_rate: numOrNull(r.win_rate),
    sharpe: numOrNull(r.sharpe),
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
