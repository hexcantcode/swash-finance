/**
 * Per-trader detail for an EP-cohort wallet: its open positions, recent
 * completed trades, and basic Hyperdash stats (PnL, win rate, top assets).
 *
 * Reuses the same per-trader Hyperdash ops as the feed fan-outs, but for a
 * single address (and a larger trades page). Stats come from the curated
 * copytraders group (the documented source of `winrate` / `topAssets`); when
 * the address isn't in that group, stats are null but positions + trades still
 * return. NO Swash score is computed here.
 *
 * Source: Hyperdash public GraphQL. See the `.claude/skills/hyperdash-top-traders` skill.
 */

import { hdFetch, ttlCache } from './shared.js';

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

const GROUP_QUERY = `query GetSystemGroupTraders($groupId: ID!) {
  getSystemGroupTraders(groupId: $groupId) {
    address displayName pnl winrate copyScore topAssets { coin volume pnl }
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

export interface EpTraderTopAsset {
  coin: string;
  volumeUsd: number;
  pnlUsd: number;
}

/** Basic Hyperdash stats for the wallet; null when it's not in the curated group. */
export interface EpTraderStats {
  pnlUsd: number;
  /** 0–100 (already a percentage). */
  winratePct: number;
  copyScore: number;
  topAssets: EpTraderTopAsset[];
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
interface RawGroupTrader {
  address: string;
  displayName: string | null;
  pnl: number | string | null;
  winrate: number | string | null;
  copyScore: number | null;
  topAssets: { coin: string; volume: number | string | null; pnl: number | string | null }[] | null;
}

// The curated group's stats move slowly; cache the whole group once and look up
// addresses against it (it's the documented source of winrate / topAssets).
const groupCache = ttlCache<Map<string, RawGroupTrader>>(600_000);

async function getGroupStats(): Promise<Map<string, RawGroupTrader>> {
  const fresh = groupCache.get();
  if (fresh) return fresh;
  try {
    const data = await hdFetch<{ getSystemGroupTraders?: RawGroupTrader[] }>('GetSystemGroupTraders', GROUP_QUERY, {
      groupId: 'copytraders',
    });
    const rows = data?.getSystemGroupTraders ?? [];
    if (rows.length === 0) return groupCache.last() ?? new Map();
    const map = new Map(rows.map((r) => [r.address.toLowerCase(), r]));
    return groupCache.set(map);
  } catch {
    return groupCache.last() ?? new Map();
  }
}

export async function getEpTraderDetail(address: string): Promise<EpTraderDetail | null> {
  const nowMs = Date.now();

  const [posData, tradeData, group] = await Promise.all([
    hdFetch<{ traderPerpPositionsTooltip?: { positions: RawPosition[] | null } }>(
      'TraderPerpPositionsTooltip',
      POSITIONS_QUERY,
      { address, timestamp: nowMs, limit: POSITIONS_LIMIT },
    ).catch(() => null),
    hdFetch<{ getTraderCompletedTrades?: { trades: RawTrade[] | null } }>('GetTraderCompletedTrades', TRADES_QUERY, {
      address,
      pageSize: TRADES_PAGE,
    }).catch(() => null),
    getGroupStats(),
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

  const row = group.get(address.toLowerCase());
  const stats: EpTraderStats | null = row
    ? {
        pnlUsd: Number(row.pnl) || 0,
        winratePct: Number(row.winrate) || 0,
        copyScore: row.copyScore ?? 0,
        topAssets: (row.topAssets ?? []).map((a) => ({
          coin: a.coin,
          volumeUsd: Number(a.volume) || 0,
          pnlUsd: Number(a.pnl) || 0,
        })),
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
