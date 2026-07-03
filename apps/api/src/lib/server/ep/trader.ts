/**
 * Per-trader detail for an EP-cohort wallet: its open positions, recent
 * completed trades, and basic stats (PnL, win rate, top assets).
 *
 * Reuses the same per-trader Hyperdash ops as the feed fan-outs, but for a
 * single address (and a larger trades page). Stats come from the EP roster row
 * (the single source for cohort stats); `stats` is null only when the address
 * isn't in the roster — an acceptable edge case, since every tappable trader
 * comes from the roster. NO Swash score is computed here.
 *
 * Source: Hyperdash public GraphQL. See the `.claude/skills/hyperdash-top-traders` skill.
 */

import { getEpRoster, type EpTopAsset } from './roster.js';
import { hdFetch } from './shared.js';

/** Recent completed trades to pull for the detail view. */
const TRADES_PAGE = 20;
/** Open positions to pull (no notional floor — show the wallet's real book). */
const POSITIONS_LIMIT = 50;

const POSITIONS_QUERY = `query TraderPerpPositionsTooltip($address: String!, $timestamp: Float!, $limit: Int) {
  traderPerpPositionsTooltip(address: $address, timestamp: $timestamp, limit: $limit) {
    positions { market size notionalSize entryPrice unrealizedPnl }
  }
}`;

const TRADES_QUERY = `query GetTraderCompletedTrades($address: String!, $pageSize: Int) {
  getTraderCompletedTrades(address: $address, pageSize: $pageSize) {
    trades { endTime coin direction sz avgEntryPx avgExitPx netPnl notional }
  }
}`;

export interface EpTraderPosition {
  coin: string;
  side: 'long' | 'short';
  szBase: number;
  notionalUsd: number;
  entryPxUsd: number;
  unrealizedPnlUsd: number;
}

export interface EpTraderTrade {
  coin: string;
  /** 'Long' | 'Short' as Hyperdash reports it. */
  direction: string;
  szBase: number;
  entryPxUsd: number;
  exitPxUsd: number;
  netPnlUsd: number;
  notionalUsd: number;
  closedAtMs: number;
}

/** Basic stats for the wallet from the EP roster; null when it's not in the roster. */
export interface EpTraderStats {
  pnlUsd: number;
  /** 0–100 (already a percentage). */
  winratePct: number;
  copyScore: number;
  totalTrades: number;
  sharpe: number;
  drawdown: number;
  topAssets: EpTopAsset[];
}

export interface EpTraderDetail {
  address: string;
  displayName: string | null;
  stats: EpTraderStats | null;
  positions: EpTraderPosition[];
  trades: EpTraderTrade[];
}

interface RawPosition {
  market: string;
  size: number | null;
  notionalSize: number | null;
  entryPrice: number | null;
  unrealizedPnl: number | null;
}
interface RawTrade {
  endTime: number | string | null;
  coin: string;
  direction: string;
  sz: number | null;
  avgEntryPx: number | null;
  avgExitPx: number | null;
  netPnl: number | null;
  notional: number | null;
}

export async function getEpTraderDetail(address: string): Promise<EpTraderDetail | null> {
  const nowMs = Date.now();

  const [posData, tradeData, roster] = await Promise.all([
    hdFetch<{ traderPerpPositionsTooltip?: { positions: RawPosition[] | null } }>(
      'TraderPerpPositionsTooltip',
      POSITIONS_QUERY,
      { address, timestamp: nowMs, limit: POSITIONS_LIMIT },
    ).catch(() => null),
    hdFetch<{ getTraderCompletedTrades?: { trades: RawTrade[] | null } }>('GetTraderCompletedTrades', TRADES_QUERY, {
      address,
      pageSize: TRADES_PAGE,
    }).catch(() => null),
    getEpRoster(),
  ]);

  const positions: EpTraderPosition[] = (posData?.traderPerpPositionsTooltip?.positions ?? [])
    .filter((p) => (Number(p.size) || 0) !== 0)
    .map((p) => {
      const size = Number(p.size) || 0;
      return {
        coin: p.market,
        side: size > 0 ? 'long' : 'short',
        szBase: Math.abs(size),
        notionalUsd: Math.abs(Number(p.notionalSize) || 0),
        entryPxUsd: Number(p.entryPrice) || 0,
        unrealizedPnlUsd: Number(p.unrealizedPnl) || 0,
      };
    });

  const trades: EpTraderTrade[] = (tradeData?.getTraderCompletedTrades?.trades ?? [])
    .map((tr) => ({
      coin: tr.coin,
      direction: tr.direction,
      szBase: Number(tr.sz) || 0,
      entryPxUsd: Number(tr.avgEntryPx) || 0,
      exitPxUsd: Number(tr.avgExitPx) || 0,
      netPnlUsd: Number(tr.netPnl) || 0,
      notionalUsd: Number(tr.notional) || 0,
      closedAtMs: typeof tr.endTime === 'string' ? Date.parse(tr.endTime) : Number(tr.endTime) || 0,
    }))
    .sort((a, b) => b.closedAtMs - a.closedAtMs);

  const row = roster.find((t) => t.address.toLowerCase() === address.toLowerCase());
  const stats: EpTraderStats | null = row
    ? {
        pnlUsd: row.pnlUsd,
        winratePct: row.winratePct,
        copyScore: row.copyScore,
        totalTrades: row.totalTrades,
        sharpe: row.sharpe,
        drawdown: row.drawdown,
        topAssets: row.topAssets,
      }
    : null;

  // Nothing at all for this address → treat as not found.
  if (positions.length === 0 && trades.length === 0 && !stats) return null;

  return {
    address,
    displayName: row?.displayName ?? null,
    stats,
    positions,
    trades,
  };
}
