import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import {
  fills,
  fundings,
  ledgerUpdates,
  scores,
  walletTags,
  wallets,
  type NewScore,
  type NewWalletTag,
} from '@copytrade/db';
import {
  annualizedSharpe,
  annualizedSortino,
  buildDailySeries,
  classifyAssetClass,
  classifyCadence,
  classifyHeat,
  classifyMainTag,
  classifyRisk,
  classifySize,
  computeBehavioral,
  computeDecayFlag,
  dailySharpe,
  expectancy,
  maxDrawdownPct,
  medianComposite,
  monthlyConsistency,
  probabilisticSharpe,
  profitFactor,
  recoveryTimeDays,
  toDailyReturns,
  trackRecordMultiplier,
  winRate,
} from '@copytrade/scoring';
import { db } from '../db.js';
import { hl } from '../hl.js';
import { log } from '../log.js';

const MS_DAY = 24 * 60 * 60 * 1000;
const MIN_FILLS_FOR_SCORING = 10;
const RECENT_WINDOW_180D_MS = 180 * MS_DAY;

/**
 * Eligibility floors borrowed from kismet's HL worker. These drop two
 * categories of garbage before we spend scoring CPU on them:
 *
 *   - $0 → profited → withdrew everything wallets that produce
 *     millions-of-percent ROI (account_value catches them)
 *   - Tiny accounts that 100x'd on a single $50 trade (volume catches them)
 *
 * Wallets in the `wallets` table that miss either floor are silently skipped.
 */
const MIN_ACCOUNT_VALUE_USD = 1_000;
const MIN_VOLUME_USD = 10_000;

/**
 * J-1: recompute scores for every active master wallet.
 *
 * Steps:
 *   1. Pick candidates: ≥10 fills, last seen within 180 days, is_agent=false.
 *   2. For each candidate, query fills/fundings/ledger across master + agents.
 *   3. Build daily series → metrics → tags → composite.
 *   4. Upsert into `scores` and `wallet_tags`; update wallets.composite_score.
 *
 * Determinism: same inputs ⇒ same outputs (no random sampling).
 */
export async function runScoreRecompute(opts: { onlyAddress?: string } = {}): Promise<void> {
  const start = Date.now();

  // 1. Resolve HIP-3 dexes once (used for asset-class tagging).
  const perpDexs = await hl().perpDexs();
  const hip3Dexes = new Set<string>();
  for (const dex of perpDexs.data) if (dex) hip3Dexes.add(dex.name);

  // 2. Candidates.
  const cutoff = new Date(Date.now() - RECENT_WINDOW_180D_MS);
  const candidates = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(
      and(
        opts.onlyAddress ? eq(wallets.address, opts.onlyAddress) : sql`true`,
        eq(wallets.isAgent, false),
        gte(wallets.lastSeenAt, cutoff),
        gte(wallets.totalFills, MIN_FILLS_FOR_SCORING),
        // Eligibility floors. Skip if either is set + below threshold.
        // null account_value means we haven't fetched it yet; allow through.
        sql`(${wallets.accountValue} is null or ${wallets.accountValue} >= ${MIN_ACCOUNT_VALUE_USD})`,
        sql`${wallets.totalVolumeUsd} >= ${MIN_VOLUME_USD}`,
      ),
    );

  log.info({ candidateCount: candidates.length, onlyAddress: opts.onlyAddress }, 'score.start');

  // Single pass: each wallet's PSR uses its own daily Sharpe vs a 0 benchmark,
  // so no population statistics are needed.
  let scored = 0;
  let tagged = 0;
  for (const c of candidates) {
    try {
      const result = await scoreSingleWallet({ address: c.address, hip3Dexes });
      scored += 1;
      tagged += result.tagsApplied;
    } catch (err: unknown) {
      log.error(
        { address: c.address, err: err instanceof Error ? err.message : String(err) },
        'score.wallet_failed',
      );
    }
  }

  log.info({ scored, tagged, ms: Date.now() - start }, 'score.done');
}

async function scoreSingleWallet(args: {
  address: string;
  hip3Dexes: Set<string>;
}): Promise<{ tagsApplied: number }> {
  const addresses = await collectMasterAndAgents(args.address);

  const fillsRows = await db()
    .select()
    .from(fills)
    .where(inArray(fills.userAddress, addresses));
  if (fillsRows.length < MIN_FILLS_FOR_SCORING) return { tagsApplied: 0 };

  const fundingsRows = await db()
    .select()
    .from(fundings)
    .where(inArray(fundings.userAddress, addresses));
  const ledgerRows = await db()
    .select()
    .from(ledgerUpdates)
    .where(inArray(ledgerUpdates.userAddress, addresses));

  const series = buildDailySeries({
    fills: fillsRows.map((f) => ({
      blockTimeMs: f.blockTimeMs,
      closedPnl: f.closedPnl,
      fee: f.fee,
      sz: f.sz,
      px: f.px,
    })),
    fundings: fundingsRows.map((f) => ({ blockTimeMs: f.blockTimeMs, usdc: f.usdc })),
    ledger: ledgerRows.map((l) => ({
      blockTimeMs: l.blockTimeMs,
      type: l.type,
      usdc: l.usdc,
    })),
  });

  const initialDeposit = estimateInitialDeposit(ledgerRows);
  const returns = toDailyReturns(series, initialDeposit);
  const perTradePnl = fillsRows.map((f) => Number.parseFloat(f.closedPnl) - Number.parseFloat(f.fee));

  // Track-record span (calendar days between first and last event). Drives the
  // track-record multiplier applied to Sharpe/Sortino in the composite basket.
  const daysOfData =
    series.firstEventMs !== null && series.lastEventMs !== null
      ? (series.lastEventMs - series.firstEventMs) / MS_DAY
      : 0;
  const mult = trackRecordMultiplier(daysOfData);

  // Risk metrics. PSR consumes the *daily* (un-annualized) Sharpe; the
  // annualized Sharpe is kept only for the `scores.sharpe` display column.
  const sharpe = annualizedSharpe(returns);
  const dSharpe = dailySharpe(returns);
  const sortino = annualizedSortino(returns);
  const sortinoDaily = sortino !== null ? sortino / Math.sqrt(365) : null;
  const maxDd = maxDrawdownPct(returns);
  const recovery = recoveryTimeDays(returns);
  const pf = profitFactor(perTradePnl);
  const wr = winRate(perTradePnl);
  const exp = expectancy(perTradePnl);
  const psr = dSharpe !== null ? probabilisticSharpe(returns, dSharpe, 0) : null;
  const monthlyConsistencyVal = monthlyConsistency(
    series.daily.map((d) => ({ dayKey: d.dayKey, pnl: d.pnl })),
  );

  // Rolling-window Sharpes for decay tracking
  const recent30 = lastNDays(returns, series, 30);
  const recent7 = lastNDays(returns, series, 7);
  const rolling30dSharpe = annualizedSharpe(recent30);
  const rolling7dSharpe = annualizedSharpe(recent7);
  const peakSharpe = computePeakRollingSharpe(returns);

  // Behavioral
  const behavioral = computeBehavioral(
    fillsRows.map((f) => ({
      blockTimeMs: f.blockTimeMs,
      coin: f.coin,
      side: f.side as 'B' | 'A',
      px: f.px,
      sz: f.sz,
      startPosition: f.startPosition,
      crossed: f.crossed,
    })),
    { activeDays: series.activeDays },
  );

  // Tag classification
  const firstSeenDaysAgo =
    series.firstEventMs !== null ? (Date.now() - series.firstEventMs) / MS_DAY : 0;
  const lastTradeDaysAgo =
    series.lastEventMs !== null ? (Date.now() - series.lastEventMs) / MS_DAY : Infinity;

  const primaryAssetClass = behavioral.primaryAsset
    ? classifyAssetClass(behavioral.primaryAsset, args.hip3Dexes)
    : null;

  const mainTag = classifyMainTag({
    totalTrades: fillsRows.length,
    activeDays: series.activeDays,
    firstSeenDaysAgo,
    lastTradeDaysAgo,
    psr,
    maxDrawdownPct: maxDd,
    assetConcentration: behavioral.assetConcentration,
    tradesPerDayAvg: behavioral.tradesPerDayAvg,
    primaryAsset: behavioral.primaryAsset,
    primaryAssetClass,
    avgHoldSeconds: behavioral.avgHoldSeconds,
    totalVolumeUsd: behavioral.totalNotional.toNumber(),
    recentRollingSharpe: rolling30dSharpe,
    peakRollingSharpe: peakSharpe,
    longShortRatio: behavioral.longShortRatio,
    fundingPnlPct: null,
  });
  const cadenceTag = classifyCadence(behavioral.avgHoldSeconds);
  const riskTag = classifyRisk(maxDd, behavioral.longShortRatio);
  const heatTag = classifyHeat(rolling30dSharpe, peakSharpe);
  const sizeTag = classifySize(behavioral.totalNotional.toNumber());
  const decayFlag = computeDecayFlag(rolling30dSharpe, peakSharpe);

  // Composite — 7-metric median basket. Sharpe/Sortino are the daily-unit
  // values scaled by the track-record multiplier. (`expectancy` is intentionally
  // NOT in the basket — raw-USD, scale-dependent, undiscriminating near zero;
  // still computed for the `scores.expectancy` display column below.)
  const composite = medianComposite({
    metrics: {
      sharpe: dSharpe !== null ? dSharpe * mult : null,
      sortino: sortinoDaily !== null ? sortinoDaily * mult : null,
      psr,
      profitFactor: pf,
      maxDrawdownPct: maxDd,
      recoveryTimeDays: recovery,
      monthlyConsistency: monthlyConsistencyVal,
    },
    daysOfData,
  });

  const now = new Date();
  const scoreRow: NewScore = {
    address: args.address,
    computedAt: now,
    totalTrades: fillsRows.length,
    totalRoundTrips: 0,
    totalVolumeUsd: clampNetPnlUsd(behavioral.totalNotional.toNumber()),
    firstTradeAt:
      series.firstEventMs !== null ? new Date(series.firstEventMs) : null,
    lastTradeAt: series.lastEventMs !== null ? new Date(series.lastEventMs) : null,
    activeDays: series.activeDays,
    netPnlUsd: clampNetPnlUsd(series.netPnl.toNumber()),
    netPnlPct: computeRoi(series.netPnl.toNumber(), ledgerRows),
    sharpe: numToStr(sharpe),
    sortino: numToStr(sortino),
    calmar: null,
    psr: numToStr(psr),
    dsr: null,
    profitFactor: numToStr(pf),
    winRate: numToStr(wr),
    expectancy: numToStr(exp),
    maxDrawdownPct: numToStr(maxDd),
    recoveryTimeDays: recovery,
    avgHoldSeconds: behavioral.avgHoldSeconds !== null ? Math.round(behavioral.avgHoldSeconds) : null,
    tradesPerDayAvg: numToStr(behavioral.tradesPerDayAvg),
    makerTakerRatio: numToStr(behavioral.makerTakerRatio),
    assetConcentration: numToStr(behavioral.assetConcentration),
    primaryAsset: behavioral.primaryAsset,
    primaryDex: null,
    longShortRatio: numToStr(behavioral.longShortRatio),
    fundingPnlPct: null,
    rolling30dSharpe: numToStr(rolling30dSharpe),
    rolling7dSharpe: numToStr(rolling7dSharpe),
    decayFlag,
    compositeScore: composite.score,
    updatedAt: now,
  };

  await db()
    .insert(scores)
    .values(scoreRow)
    .onConflictDoUpdate({
      target: scores.address,
      set: { ...scoreRow, updatedAt: now },
    });

  // Replace tags atomically: clear then re-insert.
  await db().delete(walletTags).where(eq(walletTags.address, args.address));

  const tagRows: NewWalletTag[] = [];
  if (mainTag) tagRows.push({ address: args.address, tagType: 'main', tagValue: mainTag });
  if (primaryAssetClass)
    tagRows.push({ address: args.address, tagType: 'asset', tagValue: primaryAssetClass });
  if (cadenceTag)
    tagRows.push({ address: args.address, tagType: 'cadence', tagValue: cadenceTag });
  if (riskTag) tagRows.push({ address: args.address, tagType: 'risk', tagValue: riskTag });
  if (heatTag) tagRows.push({ address: args.address, tagType: 'heat', tagValue: heatTag });
  tagRows.push({ address: args.address, tagType: 'size', tagValue: sizeTag });

  if (tagRows.length > 0) {
    await db().insert(walletTags).values(tagRows);
  }

  await db()
    .update(wallets)
    .set({
      compositeScore: composite.score,
      primaryTag: mainTag,
      ingestState: 'scored',
      updatedAt: now,
    })
    .where(eq(wallets.address, args.address));

  return { tagsApplied: tagRows.length };
}

async function collectMasterAndAgents(masterAddress: string): Promise<string[]> {
  const agents = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(or(eq(wallets.address, masterAddress), eq(wallets.masterAddress, masterAddress)));
  return agents.map((a) => a.address);
}

function estimateInitialDeposit(rows: Array<{ usdc: string | null; type: string }>): number {
  for (const r of rows) {
    if (r.type === 'deposit' && r.usdc !== null) return Number.parseFloat(r.usdc);
  }
  return 1000; // sane default for users who never deposited (e.g., rebated)
}

/**
 * Return on investment as net_pnl / total observed deposits. Returns null when
 * we have no deposit history — those wallets were funded via subaccount or
 * spot transfers we don't index, and showing an inflated ROI against a $1000
 * fallback would mislead.
 */
function computeRoi(
  netPnl: number,
  ledgerRows: Array<{ usdc: string | null; type: string }>,
): string | null {
  let totalDeposits = 0;
  for (const r of ledgerRows) {
    if (r.type === 'deposit' && r.usdc !== null) {
      const n = Number.parseFloat(r.usdc);
      if (Number.isFinite(n)) totalDeposits += n;
    }
  }
  if (totalDeposits <= 0) return null;
  const roi = netPnl / totalDeposits;
  if (!Number.isFinite(roi)) return null;
  // Clamp to numeric(20,8) bounds; in practice ROI rarely exceeds 100x.
  const clamped = Math.max(-999, Math.min(999, roi));
  return clamped.toFixed(8);
}

function lastNDays(
  returns: number[],
  series: ReturnType<typeof buildDailySeries>,
  days: number,
): number[] {
  if (returns.length === 0) return [];
  return returns.slice(Math.max(0, series.daily.length - days));
}

function computePeakRollingSharpe(returns: number[]): number | null {
  if (returns.length < 30) return annualizedSharpe(returns);
  let peak = -Infinity;
  for (let start = 0; start + 30 <= returns.length; start++) {
    const window = returns.slice(start, start + 30);
    const sr = annualizedSharpe(window);
    if (sr !== null && sr > peak) peak = sr;
  }
  return Number.isFinite(peak) ? peak : null;
}

/** Cap to fit numeric(30,8): max |value| 9.999999999999999999999e21. */
const NET_PNL_MAX = 1e21;
function clampNetPnlUsd(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) > NET_PNL_MAX) return value > 0 ? NET_PNL_MAX.toFixed(8) : (-NET_PNL_MAX).toFixed(8);
  return value.toFixed(8);
}

/** Cap to fit numeric(10,4): max |value| 999999.9999. Returns null when finite-but-out-of-range. */
const RATIO_MAX = 999999.999;
function numToStr(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) > RATIO_MAX) return value > 0 ? RATIO_MAX.toFixed(4) : (-RATIO_MAX).toFixed(4);
  return value.toFixed(4);
}
