import { and, asc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import {
  fills,
  fundings,
  leaderCache,
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
  classifyHeat,
  classifyProfile,
  classifySize,
  computeBehavioral,
  computeDecayFlag,
  computeLeverageProfile,
  computeScore,
  expectancy,
  isMarketMakerPattern,
  MIN_ACCOUNT_VALUE_USD,
  maxDrawdownPct,
  monthlyConsistency,
  passesGate,
  profitFactor,
  recoveryTimeDays,
  toDailyReturns,
  weeklyProfitableRatio,
  winRate,
} from '@copytrade/scoring';
import { db } from '../db.js';
import { hl } from '../hl.js';
import { log } from '../log.js';

const MS_DAY = 24 * 60 * 60 * 1000;
const MIN_FILLS_FOR_SCORING = 10;
const RECENT_WINDOW_180D_MS = 180 * MS_DAY;

/**
 * Candidate floors. Below these we don't spend scoring CPU — and `MIN_ACCOUNT_VALUE_USD`
 * (= the leaderboard *listing* floor, owned by `@copytrade/scoring`) also drops
 * the "$0 → profited → withdrew everything" wallets that produce millions-of-%
 * ROI. `MIN_VOLUME_USD` is a looser lifetime-volume floor than curation's.
 * Wallets in the `wallets` table that miss either are silently skipped.
 */
const MIN_VOLUME_USD = 10_000;

/**
 * J-1: recompute scores for every active master wallet.
 *
 * Steps:
 *   1. Pick candidates: ≥10 fills, last seen within 180 days, is_agent=false.
 *   2. For each candidate, query fills/fundings/ledger across master + agents.
 *   3. Build daily series → metrics → tags → composite.
 *   4. Upsert into `scores` and `wallet_tags`; update wallets.score.
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
  //
  // Equity source: prefer the live `leader_cache.account_value` over the
  // leaderboard snapshot in `wallets.account_value`. The two can diverge
  // significantly (leaderboard refreshes lag clearinghouseState, and the
  // leaderboard snapshot keeps showing peak equity after large withdrawals),
  // so the gate has to read the freshest number we have to avoid scoring
  // wallets whose live equity has fallen below the floor since the last
  // snapshot. The live-tier writers (`leader-cache-poll`, `ws-live-subscriber`)
  // also call `stampIfBelowFloor` for the same reason — see
  // `apps/worker/src/lib/gate-reconcile.ts`.
  const cutoff = new Date(Date.now() - RECENT_WINDOW_180D_MS);
  const effectiveAccountValue = sql<string | null>`coalesce(${leaderCache.accountValue}, ${wallets.accountValue})`;
  const candidates = await db()
    .select({
      address: wallets.address,
      accountValue: effectiveAccountValue,
      firstSeenAt: wallets.firstSeenAt,
      // Score v2: profit input reads HL's reported 30d ROI directly — no
      // deposit-base reconstruction in the path anymore.
      hlRoi30d: wallets.hlRoi30d,
    })
    .from(wallets)
    .leftJoin(leaderCache, eq(leaderCache.address, wallets.address))
    .where(
      and(
        opts.onlyAddress ? eq(wallets.address, opts.onlyAddress) : sql`true`,
        eq(wallets.isAgent, false),
        gte(wallets.lastSeenAt, cutoff),
        gte(wallets.totalFills, MIN_FILLS_FOR_SCORING),
        // Account-value floor. The bulk run is strict — a null/below-floor
        // equity can never reach the leaderboard (`leaders.ts` requires
        // `account_value >= MIN_ACCOUNT_VALUE_USD`), so scoring it is wasted CPU.
        // An explicit on-demand request (`onlyAddress`) is allowed through with a
        // null equity (the refresh path may not have fetched it yet) — it just
        // won't be listed/curated until it does.
        opts.onlyAddress
          ? sql`(${effectiveAccountValue} is null or ${effectiveAccountValue} >= ${MIN_ACCOUNT_VALUE_USD})`
          : sql`${effectiveAccountValue} >= ${MIN_ACCOUNT_VALUE_USD}`,
        sql`${wallets.totalVolumeUsd} >= ${MIN_VOLUME_USD}`,
      ),
    );

  log.info({ candidateCount: candidates.length, onlyAddress: opts.onlyAddress }, 'score.start');

  // Single pass: each wallet's PSR uses its own daily Sharpe vs a 0 benchmark,
  // so no population statistics are needed.
  let scored = 0;
  let tagged = 0;
  let curatedCount = 0;
  for (const c of candidates) {
    try {
      const result = await scoreSingleWallet({
        address: c.address,
        hip3Dexes,
        accountValue: c.accountValue,
        firstSeenAt: c.firstSeenAt,
        hlRoi30d: c.hlRoi30d,
      });
      scored += 1;
      tagged += result.tagsApplied;
      if (result.scored) curatedCount += 1;
    } catch (err: unknown) {
      log.error(
        { address: c.address, err: err instanceof Error ? err.message : String(err) },
        'score.wallet_failed',
      );
    }
  }

  log.info({ scored, tagged, curatedCount, ms: Date.now() - start }, 'score.done');
}

async function scoreSingleWallet(args: {
  address: string;
  hip3Dexes: Set<string>;
  accountValue: string | null;
  firstSeenAt: Date;
  hlRoi30d: string | null;
}): Promise<{ tagsApplied: number; scored: boolean }> {
  const addresses = await collectMasterAndAgents(args.address);

  // Stable, deterministic order. `computeBehavioral` sorts by blockTimeMs but JS
  // sort is stable — same-ms fill ties (HL packs many into one block) preserve
  // whatever order Postgres returned, which makes cycle boundaries (and thus
  // `winRate`) non-deterministic. Tie-break on `tid` (monotonic intra-block).
  const fillsRows = await db()
    .select()
    .from(fills)
    .where(inArray(fills.userAddress, addresses))
    .orderBy(asc(fills.blockTimeMs), asc(fills.tid));
  if (fillsRows.length < MIN_FILLS_FOR_SCORING) return { tagsApplied: 0, scored: false };

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
  // `perTradePnl` keeps the per-fill (closedPnl − fee) shape — feeds the
  // `profitFactor` / `expectancy` display columns where the per-fill basis
  // is fine. Win-rate is computed separately below from the per-round-trip
  // PnLs `computeBehavioral` returns; that matches the convention every
  // hedge-fund / copy-trading platform reports (one open→flat cycle = one
  // win/loss, not one per closing fill).
  const perTradePnl = fillsRows.map((f) => Number.parseFloat(f.closedPnl) - Number.parseFloat(f.fee));

  // Track-record span — display only (the score itself reads the 90d
  // weekly-consistency ratio, not this).
  const daysOfData =
    series.firstEventMs !== null && series.lastEventMs !== null
      ? (series.lastEventMs - series.firstEventMs) / MS_DAY
      : 0;

  // Risk / quality stats — all kept as display columns on `scores.*`. PSR
  // consumes the *daily* (un-annualized) Sharpe; the annualized Sharpe is
  // for the `scores.sharpe` display column.
  const sharpe = annualizedSharpe(returns);
  const sortino = annualizedSortino(returns);
  const maxDd = maxDrawdownPct(returns);
  const recovery = recoveryTimeDays(returns);
  const pf = profitFactor(perTradePnl);
  const exp = expectancy(perTradePnl);
  // Win rate (declared below — needs `behavioral.roundTripPnls`).
  // PSR dropped in score v2 (it only fed the old composite). `scores.psr`
  // column kept for backwards compatibility, written as null.
  const psr: number | null = null;
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
      closedPnl: f.closedPnl,
      fee: f.fee,
    })),
    { activeDays: series.activeDays },
  );

  // Win rate over completed round trips — one entry per open→flat cycle,
  // signed by the cycle's net realized PnL. Industry convention; what every
  // hedge fund factsheet means by "win rate". See behavioral.ts
  // `computeRoundTripPnls`.
  const wr = winRate(behavioral.roundTripPnls);

  // Tag classification
  const lastTradeDaysAgo =
    series.lastEventMs !== null ? (Date.now() - series.lastEventMs) / MS_DAY : Infinity;

  const primaryAssetClass = behavioral.primaryAsset
    ? classifyAssetClass(behavioral.primaryAsset, args.hip3Dexes)
    : null;

  const accountValueUsd =
    args.accountValue !== null && Number.isFinite(Number.parseFloat(args.accountValue))
      ? Number.parseFloat(args.accountValue)
      : null;

  // "Profile" — the one archetype tag shown next to the composite score.
  const profileTag = classifyProfile({
    roundTrips: behavioral.roundTrips,
    daysOfData,
    lastTradeDaysAgo,
    psr,
    maxDrawdownPct: maxDd,
    assetConcentration: behavioral.assetConcentration,
    tradesPerDayAvg: behavioral.tradesPerDayAvg,
    primaryAssetClass,
    monthlyConsistency: monthlyConsistencyVal,
    rolling30dSharpe,
    peakRollingSharpe: peakSharpe,
    accountValueUsd,
  });
  const heatTag = classifyHeat(rolling30dSharpe, peakSharpe);
  const sizeTag = classifySize(behavioral.totalNotional.toNumber());
  const decayFlag = computeDecayFlag(rolling30dSharpe, peakSharpe);

  // ── Score v2 ───────────────────────────────────────────────────────────
  // Two stages: gate (3 hard rules) → score (0.4·profit + 0.3·consistency +
  // 0.3·risk, each on a linear band). See docs/plans/2026-05-13-score-v2-design.md.
  // The Sharpe/Sortino/PSR/profit-factor/maxDD numbers computed above are
  // kept as display-only stats on the `scores` row — they no longer feed the
  // score itself.

  // Gate input: bot/MM detection still uses the existing behavioral signals
  // (high maker share + sub-minute holds + balanced long-short + many fills).
  const isMarketMaker = isMarketMakerPattern({
    makerShare: behavioral.makerTakerRatio,
    avgHoldSeconds: behavioral.avgHoldSeconds,
    longShortRatio: behavioral.longShortRatio,
    totalFills: fillsRows.length,
  });
  const gate = passesGate({
    accountValueUsd,
    lastFillMs: series.lastEventMs,
    isMarketMaker,
    nowMs: Date.now(),
  });

  // Score inputs (only consumed if the gate passes — but cheap to compute).
  const weeklyConsistency = weeklyProfitableRatio({
    fills: fillsRows.map((f) => ({
      blockTimeMs: f.blockTimeMs,
      closedPnl: Number.parseFloat(f.closedPnl),
    })),
  });
  const hlRoi30dNumber =
    args.hlRoi30d !== null && Number.isFinite(Number.parseFloat(args.hlRoi30d))
      ? Number.parseFloat(args.hlRoi30d)
      : null;
  const scoreResult = gate.passed
    ? computeScore({
        roi30d: hlRoi30dNumber,
        weeksProfitableRatio: weeklyConsistency.ratio,
        maxDrawdownPct: maxDd,
      })
    : null;
  const scoreValue = scoreResult?.score ?? null;

  // Reconstruct the leverage profile for the `scores.expectancy`/display
  // stats only (the score doesn't read it).
  const leverageProfile = computeLeverageProfile(
    fillsRows.map((f) => ({
      blockTimeMs: f.blockTimeMs,
      coin: f.coin,
      side: f.side as 'B' | 'A',
      px: f.px,
      sz: f.sz,
      startPosition: f.startPosition,
    })),
    accountValueUsd,
  );

  // `curated` becomes a derived "score is computed" boolean: gate passed AND
  // all three inputs available. No more separate threshold (composite ≥ 70)
  // or hysteresis logic; the gate is the gate.
  const nowCurated = scoreValue !== null;
  void leverageProfile; // referenced by no current write; kept for log line below

  // The deposit-base ROI (`netPnlPct`) is no longer in the score path, but
  // we keep computing it for the trader page's display column (it answers
  // "ROI on visible deposits"). Wallets without a reconstructable deposit
  // base just show "—" for that field; the score doesn't care.
  const netPnlPct = computeRoi(series.netPnl.toNumber(), ledgerRows);

  const now = new Date();
  const scoreRow: NewScore = {
    address: args.address,
    computedAt: now,
    totalTrades: fillsRows.length,
    totalRoundTrips: behavioral.roundTrips,
    totalVolumeUsd: clampNetPnlUsd(behavioral.totalNotional.toNumber()),
    firstTradeAt:
      series.firstEventMs !== null ? new Date(series.firstEventMs) : null,
    lastTradeAt: series.lastEventMs !== null ? new Date(series.lastEventMs) : null,
    activeDays: series.activeDays,
    netPnlUsd: clampNetPnlUsd(series.netPnl.toNumber()),
    netPnlPct,
    // Display-only stats — no longer gated by data-quality flags, since the
    // score doesn't read them. The trader page shows the raw numbers; a
    // user can read them as "this trader's Sharpe over the visible fills".
    sharpe: numToStr(sharpe),
    sortino: numToStr(sortino),
    psr: numToStr(psr),
    profitFactor: numToStr(pf),
    winRate: winRateToStr(wr),
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
    score: scoreValue,
    updatedAt: now,
  };

  await db()
    .insert(scores)
    .values(scoreRow)
    .onConflictDoUpdate({
      target: scores.address,
      set: { ...scoreRow, updatedAt: now },
    });

  // Replace tags atomically: clear then re-insert. Three groups only —
  // `profile` (the archetype, also mirrored to `wallets.primary_tag`), `heat`,
  // `size`. The old `main`/`asset`/`cadence`/`risk` groups were dropped.
  await db().delete(walletTags).where(eq(walletTags.address, args.address));

  const tagRows: NewWalletTag[] = [
    { address: args.address, tagType: 'profile', tagValue: profileTag },
    { address: args.address, tagType: 'size', tagValue: sizeTag },
  ];
  if (heatTag) tagRows.push({ address: args.address, tagType: 'heat', tagValue: heatTag });

  await db().insert(walletTags).values(tagRows);

  await db()
    .update(wallets)
    .set({
      score: scoreValue,
      primaryTag: profileTag,
      ingestState: 'scored',
      curated: nowCurated,
      ...(nowCurated && !args.firstSeenAt ? {} : {}),
      curatedSince: nowCurated ? now : null,
      updatedAt: now,
    })
    .where(eq(wallets.address, args.address));

  log.info(
    {
      address: args.address,
      score: scoreValue,
      profile: profileTag,
      roundTrips: behavioral.roundTrips,
      ...(scoreResult
        ? {
            breakdown: scoreResult.breakdown,
            inputs: {
              roi30d: hlRoi30dNumber,
              weeksProfitable: weeklyConsistency.profitableWeeks,
              weeksActive: weeklyConsistency.weeksWithActivity,
              maxDd,
            },
          }
        : { gateFailures: gate.failures }),
    },
    'score.wallet',
  );

  return { tagsApplied: tagRows.length, scored: nowCurated };
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

// win_rate is numeric(10,5) — always in [0, 1], so no clamp needed.
function winRateToStr(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  return value.toFixed(5);
}
