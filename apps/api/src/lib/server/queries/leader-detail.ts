import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { fills, leaderCache, scores, walletTags, wallets } from '@copytrade/db';
import { db } from '../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Detail payload for the trader profile page.
 *
 * Two-tier model — one canonical source per concept:
 *  - Live tier (from `leader_cache`, WS subscriber or on-demand REST pull):
 *    `account_value`, `leverage`, `margin_used`, `open_positions`,
 *    `live_source` (`'ws'|'rest'|null`), `live_refreshed_at`. `last_trade_at`
 *    is the *freshest* last-trade timestamp available — the max of the most
 *    recent ingested fill (`fills.blockTimeMs`) and the WS-written
 *    `leader_cache.lastTradeMs`.
 *  - Analyzed tier (from `scores`, as of the last scoring run): everything
 *    under `scoring`, the top-level `total_volume_usd` (= `scoring.total_volume_usd`),
 *    `equity_curve`, `primary_asset_breakdown`, `tags`, and `analyzed_as_of`
 *    (= `scores.computedAt`).
 *  - `last_seen_at` is an internal discovery signal only — do NOT display it;
 *    use `last_trade_at`.
 */
export interface LeaderDetail {
  address: string;
  /** HL user-set display name (sparse). */
  display_name: string | null;
  /** Score v2: 0.4·profit + 0.3·consistency + 0.3·risk for gate-passers; null
   *  when the wallet failed the gate. See docs/plans/2026-05-13-score-v2-design.md. */
  score: number | null;
  primary_tag: string | null;
  tags: { type: string; value: string }[];
  scoring: ScoringDetail | null;
  recent_fills: RecentFill[];
  equity_curve: { ts: number; value: number }[];
  primary_asset_breakdown: { coin: string; volume_usd: number; share: number }[];
  /** @deprecated internal discovery signal — do not display; use last_trade_at */
  last_seen_at: string | null;
  /**
   * Freshest known last-trade time (ISO). Max of the latest ingested fill and
   * the WS-written `leader_cache.lastTradeMs`. Null only if neither exists.
   */
  last_trade_at: string | null;
  /** Analyzed-tier total volume — same source as `scoring.total_volume_usd`. */
  total_volume_usd: number | null;
  master_address: string | null;
  agent_count: number;
  /** Live tier — account equity at last cache refresh. Null if never refreshed. */
  account_value: number | null;
  /** Live tier — account-level leverage at last cache refresh. */
  leverage: number | null;
  /** Live tier — margin used at last cache refresh. */
  margin_used: number | null;
  /** Live tier — open positions snapshot from last cache refresh. */
  open_positions: OpenPosition[];
  /** @deprecated alias of `live_refreshed_at` (kept for the existing consumer). */
  positions_refreshed_at: string | null;
  /** Live tier — when the cache row was last refreshed (ISO). */
  live_refreshed_at: string | null;
  /** Live tier — origin of the cache row: `'ws'` (subscriber) or `'rest'` (pull). */
  live_source: 'ws' | 'rest' | null;
  /** Analyzed tier — when the scoring run that produced `scoring` ran (ISO). */
  analyzed_as_of: string | null;
  /** True once the user has clicked "Show all history" on this trader; the
   *  retention cron skips this wallet so its >90d fills persist. */
  history_deepened_at: string | null;
  /** Earliest fill we have stored for this wallet (ms since epoch). Powers
   *  the "Last X days" badge above the equity chart. */
  history_oldest_ms: number | null;
}

export interface OpenPosition {
  coin: string;
  side: 'long' | 'short';
  size: number;
  entryPx: number;
  markPx: number;
  positionValueUsd: number;
  unrealizedPnl: number;
  /** Return-on-equity for the position margin (signed fraction; -0.05 = -5%). */
  roe: number | null;
  leverage: number;
  leverageType: 'cross' | 'isolated' | null;
  liquidationPx: number | null;
  /** Fractional distance (0..1) of mark from liquidation. */
  distToLiqPct: number | null;
  /** Cumulative funding since the position opened. Positive = trader paid. */
  funding: number | null;
}

export interface ScoringDetail {
  net_pnl_usd: number | null;
  net_pnl_pct: number | null;
  total_trades: number;
  active_days: number;
  total_volume_usd: number | null;
  sharpe: number | null;
  sortino: number | null;
  psr: number | null;
  profit_factor: number | null;
  win_rate: number | null;
  expectancy: number | null;
  max_drawdown_pct: number | null;
  recovery_time_days: number | null;
  avg_hold_seconds: number | null;
  trades_per_day_avg: number | null;
  maker_taker_ratio: number | null;
  asset_concentration: number | null;
  rolling_30d_sharpe: number | null;
  rolling_7d_sharpe: number | null;
  decay_flag: string | null;
  computed_at: string | null;
}

export interface RecentFill {
  tid: number;
  block_time_ms: number;
  coin: string;
  side: 'B' | 'A';
  px: number;
  sz: number;
  notional: number;
  closed_pnl: number;
  fee: number;
  crossed: boolean;
}

export interface LiveSlice {
  open_positions: OpenPosition[];
  recent_fills: RecentFill[];
  live_refreshed_at: string | null;
  live_source: 'ws' | 'rest' | null;
}

// Volatile slice of the trader page — polled by the client every few seconds
// via `/trader/[address]/live`. Owns positions + recent fills + cache
// freshness in one query path so the loader and the live endpoint never drift.
export async function getLiveSlice(rawAddress: string): Promise<LiveSlice | null> {
  const address = rawAddress.toLowerCase();
  const walletRow = await db().query.wallets.findFirst({
    where: eq(wallets.address, address),
  });
  if (!walletRow) return null;
  const masterAddress = walletRow.masterAddress ?? address;

  const linkedAddresses = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(sql`${wallets.address} = ${masterAddress} or ${wallets.masterAddress} = ${masterAddress}`);
  const linked = linkedAddresses.map((r) => r.address);

  const cacheRow = await db().query.leaderCache.findFirst({
    where: eq(leaderCache.address, masterAddress),
  });
  const open_positions = parseOpenPositions(cacheRow?.positionsJson);
  const live_refreshed_at = cacheRow?.lastRefreshedAt
    ? cacheRow.lastRefreshedAt.toISOString()
    : null;
  const live_source =
    cacheRow?.source === 'ws'
      ? 'ws'
      : cacheRow?.source === 'rest_poll' || cacheRow?.source === 'rest_ondemand'
        ? 'rest'
        : null;

  const recentFillRows = await db()
    .select()
    .from(fills)
    .where(inArray(fills.userAddress, linked))
    .orderBy(desc(fills.blockTimeMs))
    .limit(50);

  const recent_fills: RecentFill[] = recentFillRows.map((f) => {
    const px = Number.parseFloat(f.px);
    const sz = Number.parseFloat(f.sz);
    return {
      tid: f.tid,
      block_time_ms: f.blockTimeMs,
      coin: f.coin,
      side: f.side as 'B' | 'A',
      px,
      sz,
      notional: px * sz,
      closed_pnl: Number.parseFloat(f.closedPnl),
      fee: Number.parseFloat(f.fee),
      crossed: f.crossed,
    };
  });

  return { open_positions, recent_fills, live_refreshed_at, live_source };
}

export async function getLeaderDetail(rawAddress: string): Promise<LeaderDetail | null> {
  const address = rawAddress.toLowerCase();
  const walletRow = await db().query.wallets.findFirst({
    where: eq(wallets.address, address),
  });
  if (!walletRow) return null;

  const masterAddress = walletRow.masterAddress ?? address;

  // All addresses contributing to this leader's history (master + agents).
  const linkedAddresses = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(sql`${wallets.address} = ${masterAddress} or ${wallets.masterAddress} = ${masterAddress}`);
  const linked = linkedAddresses.map((r) => r.address);
  const agentCount = linked.length - 1;

  const score = await db().query.scores.findFirst({
    where: eq(scores.address, masterAddress),
  });

  const cacheRow = await db().query.leaderCache.findFirst({
    where: eq(leaderCache.address, masterAddress),
  });
  const account_value = numOrNull(cacheRow?.accountValue ?? null);
  const leverage = numOrNull(cacheRow?.leverage ?? null);
  const margin_used = numOrNull(cacheRow?.marginUsed ?? null);
  const live = await getLiveSlice(masterAddress);
  const open_positions = live?.open_positions ?? [];
  const live_refreshed_at = live?.live_refreshed_at ?? null;
  const live_source = live?.live_source ?? null;

  // Score v2 (gate + computeScore) is the single source. The legacy
  // copyability breakdown panel is gone; the trader page surfaces the
  // `score` number directly. See docs/plans/2026-05-13-score-v2-design.md.

  const tagRows = await db()
    .select({ tagType: walletTags.tagType, tagValue: walletTags.tagValue })
    .from(walletTags)
    .where(eq(walletTags.address, masterAddress));

  const recent_fills = live?.recent_fills ?? [];

  // Canonical "last traded": freshest of the last ingested fill and the
  // WS-written live value. Both are epoch-ms; either or both may be missing.
  const lastFillMs = recent_fills[0]?.block_time_ms ?? null;
  const lastCacheMs = cacheRow?.lastTradeMs ?? null;
  const lastTradeMs =
    lastFillMs != null && lastCacheMs != null
      ? Math.max(lastFillMs, lastCacheMs)
      : (lastFillMs ?? lastCacheMs);
  const last_trade_at = lastTradeMs != null ? new Date(lastTradeMs).toISOString() : null;

  // Equity curve: cumulative (closedPnl - fee) per day for the last 90 days.
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const dayExpr = sql<string>`to_char(to_timestamp(${fills.blockTimeMs} / 1000.0), 'YYYY-MM-DD')`;
  const equityRows = await db()
    .select({
      day: dayExpr,
      pnl: sql<string>`sum(${fills.closedPnl} - ${fills.fee})`,
    })
    .from(fills)
    .where(
      and(
        inArray(fills.userAddress, linked),
        gte(fills.blockTimeMs, ninetyDaysAgo),
      ),
    )
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  let cum = 0;
  const equity_curve = equityRows.map((r) => {
    cum += Number.parseFloat(r.pnl ?? '0');
    return { ts: new Date(`${r.day}T00:00:00Z`).getTime(), value: cum };
  });

  // Asset breakdown.
  const volExpr = sql<string>`sum(${fills.px} * ${fills.sz})`;
  const assetBreakdownRows = await db()
    .select({
      coin: fills.coin,
      volume: volExpr,
    })
    .from(fills)
    .where(inArray(fills.userAddress, linked))
    .groupBy(fills.coin)
    .orderBy(desc(volExpr))
    .limit(8);

  const totalVol = assetBreakdownRows.reduce(
    (acc, r) => acc + Number.parseFloat(r.volume ?? '0'),
    0,
  );
  const primary_asset_breakdown = assetBreakdownRows.map((r) => {
    const v = Number.parseFloat(r.volume ?? '0');
    return {
      coin: r.coin,
      volume_usd: v,
      share: totalVol > 0 ? v / totalVol : 0,
    };
  });

  // Display name lives on the master wallet (HL's leaderboard lists masters);
  // an agent address inherits its master's name.
  const masterRow =
    masterAddress === address
      ? walletRow
      : await db().query.wallets.findFirst({ where: eq(wallets.address, masterAddress) });

  return {
    address: masterAddress,
    display_name: masterRow?.displayName ?? walletRow.displayName ?? null,
    score: walletRow.score,
    primary_tag: walletRow.primaryTag,
    tags: tagRows.map((t) => ({ type: t.tagType, value: t.tagValue })),
    scoring: score
      ? {
          net_pnl_usd: numOrNull(score.netPnlUsd),
          net_pnl_pct: numOrNull(score.netPnlPct),
          total_trades: score.totalTrades,
          active_days: score.activeDays,
          total_volume_usd: numOrNull(score.totalVolumeUsd),
          sharpe: numOrNull(score.sharpe),
          sortino: numOrNull(score.sortino),
          psr: numOrNull(score.psr),
          profit_factor: numOrNull(score.profitFactor),
          win_rate: numOrNull(score.winRate),
          expectancy: numOrNull(score.expectancy),
          max_drawdown_pct: numOrNull(score.maxDrawdownPct),
          recovery_time_days: score.recoveryTimeDays,
          avg_hold_seconds: score.avgHoldSeconds,
          trades_per_day_avg: numOrNull(score.tradesPerDayAvg),
          maker_taker_ratio: numOrNull(score.makerTakerRatio),
          asset_concentration: numOrNull(score.assetConcentration),
          rolling_30d_sharpe: numOrNull(score.rolling30dSharpe),
          rolling_7d_sharpe: numOrNull(score.rolling7dSharpe),
          decay_flag: score.decayFlag,
          computed_at: score.computedAt.toISOString(),
        }
      : null,
    recent_fills,
    equity_curve,
    primary_asset_breakdown,
    last_seen_at: walletRow.lastSeenAt.toISOString(),
    last_trade_at,
    total_volume_usd: numOrNull(score?.totalVolumeUsd ?? null),
    master_address: walletRow.masterAddress,
    agent_count: agentCount,
    account_value,
    leverage,
    margin_used,
    open_positions,
    positions_refreshed_at: live_refreshed_at,
    live_refreshed_at,
    live_source,
    analyzed_as_of: score?.computedAt?.toISOString() ?? null,
    history_deepened_at: walletRow.historyDeepenedAt?.toISOString() ?? null,
    history_oldest_ms: walletRow.historyOldestMs ?? null,
  };
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Parse the raw HL `assetPositions` snapshot stored in leader_cache.positions_json
// into the OpenPosition shape the UI consumes. Tolerant of missing / unknown
// fields — anything not parsable yields null instead of crashing the trader page.
function parseOpenPositions(raw: unknown): OpenPosition[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenPosition[] = [];
  for (const entry of raw) {
    const p = (entry as { position?: Record<string, unknown> })?.position;
    if (!p || typeof p !== 'object') continue;
    const coin = typeof p.coin === 'string' ? p.coin : null;
    const szi = toNum(p.szi);
    if (!coin || szi == null) continue;
    const entryPx = toNum(p.entryPx) ?? 0;
    const positionValue = Math.abs(toNum(p.positionValue) ?? 0);
    const markPx = szi !== 0 ? positionValue / Math.abs(szi) : entryPx;
    const side: 'long' | 'short' = szi >= 0 ? 'long' : 'short';
    const liqPx = toNum(p.liquidationPx);
    const distToLiqPct = (() => {
      if (liqPx == null || markPx <= 0) return null;
      const raw = side === 'long' ? (markPx - liqPx) / markPx : (liqPx - markPx) / markPx;
      // Negative would mean liqPx is on the wrong side of mark — bad upstream
      // data we'd rather hide than render as "0.5% from liq".
      return raw >= 0 ? raw : null;
    })();
    const lev = p.leverage as { type?: unknown; value?: unknown } | undefined;
    const leverageType =
      lev?.type === 'cross' || lev?.type === 'isolated' ? (lev.type as 'cross' | 'isolated') : null;
    const leverage = toNum(lev?.value) ?? 0;
    const cumFunding = p.cumFunding as { sinceOpen?: unknown } | undefined;
    const funding = toNum(cumFunding?.sinceOpen);
    const roe = toNum(p.returnOnEquity);
    out.push({
      coin,
      side,
      size: Math.abs(szi),
      entryPx,
      markPx,
      positionValueUsd: positionValue,
      unrealizedPnl: toNum(p.unrealizedPnl) ?? 0,
      roe,
      leverage,
      leverageType,
      liquidationPx: liqPx,
      distToLiqPct,
      funding,
    });
  }
  // Biggest plays first so a $11M short doesn't get buried under 30 dust positions.
  return out.sort((a, b) => b.positionValueUsd - a.positionValueUsd);
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
