/**
 * Wrapper for Hyperliquid's official leaderboard endpoint.
 *
 *   GET https://stats-data.hyperliquid.xyz/Mainnet/leaderboard
 *
 * This is the same backend that powers app.hyperliquid.xyz/leaderboard — open,
 * no auth, no Turnstile. Returns every active wallet on HL with pre-computed
 * pnl / roi / vlm for day / week / month / allTime. ~30MB response, fetch
 * hourly at most.
 *
 * Use this for broad discovery; the WS trades-sweep we have is good for
 * "who traded in the last minute" but misses the long tail of high-volume
 * wallets that didn't fill during the sweep window.
 */

import type { Address } from '@copytrade/shared';
import { normalizeAddress } from '@copytrade/shared';

export const DEFAULT_LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

/** A single window's snapshot of {pnl, roi, vlm}. ROI is a decimal (0.025 = 2.5%). */
export interface LeaderboardWindow {
  pnl: number;
  roi: number;
  vlm: number;
}

export interface LeaderboardRow {
  address: Address;
  accountValue: number;
  day: LeaderboardWindow;
  week: LeaderboardWindow;
  month: LeaderboardWindow;
  allTime: LeaderboardWindow;
}

/** Fetch + parse the leaderboard. Returns [] on transport failure. */
export async function fetchLeaderboard(
  options: { url?: string; signal?: AbortSignal; userAgent?: string } = {},
): Promise<LeaderboardRow[]> {
  const url = options.url ?? DEFAULT_LEADERBOARD_URL;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': options.userAgent ?? 'swish-worker/0.1',
      accept: 'application/json',
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  if (!res.ok) {
    throw new Error(`leaderboard fetch failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { leaderboardRows?: unknown };
  const raw = Array.isArray(json?.leaderboardRows) ? json.leaderboardRows : [];
  const rows: LeaderboardRow[] = [];
  for (const r of raw) {
    const parsed = parseRow(r);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

/** Return the top `limit` rows by the chosen window's PnL, desc. */
export function topByWindowPnl(
  rows: LeaderboardRow[],
  window: 'day' | 'week' | 'month' | 'allTime',
  limit: number,
): LeaderboardRow[] {
  return [...rows]
    .sort((a, b) => b[window].pnl - a[window].pnl)
    .slice(0, limit);
}

interface EligibilityCriteria {
  /** Drop wallets with current accountValue below this floor. */
  minAccountValueUsd: number;
  /** Drop wallets with 30d volume below this floor. */
  minMonthlyVolumeUsd: number;
}

export function isEligible(row: LeaderboardRow, criteria: EligibilityCriteria): boolean {
  if (row.accountValue < criteria.minAccountValueUsd) return false;
  if (row.month.vlm < criteria.minMonthlyVolumeUsd) return false;
  return true;
}

// ─── internal ──────────────────────────────────────────────────────────────

function parseRow(r: unknown): LeaderboardRow | null {
  if (!r || typeof r !== 'object') return null;
  const obj = r as Record<string, unknown>;
  const ethAddress = typeof obj['ethAddress'] === 'string' ? obj['ethAddress'] : null;
  if (!ethAddress) return null;
  let address: Address;
  try {
    address = normalizeAddress(ethAddress);
  } catch {
    return null;
  }
  const accountValue = toNumber(obj['accountValue']);
  const performances = obj['windowPerformances'];
  if (!Array.isArray(performances)) return null;

  const windows: Record<string, LeaderboardWindow> = {};
  for (const entry of performances) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [name, payload] = entry as [unknown, unknown];
    if (typeof name !== 'string' || !payload || typeof payload !== 'object') continue;
    const p = payload as Record<string, unknown>;
    windows[name] = {
      pnl: toNumber(p['pnl']),
      roi: toNumber(p['roi']),
      vlm: toNumber(p['vlm']),
    };
  }

  return {
    address,
    accountValue,
    day: windows['day'] ?? { pnl: 0, roi: 0, vlm: 0 },
    week: windows['week'] ?? { pnl: 0, roi: 0, vlm: 0 },
    month: windows['month'] ?? { pnl: 0, roi: 0, vlm: 0 },
    allTime: windows['allTime'] ?? { pnl: 0, roi: 0, vlm: 0 },
  };
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
