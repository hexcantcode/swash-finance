import { and, eq, inArray, sql } from 'drizzle-orm';
import { discoveryQueue, leaderCache, wallets } from '@copytrade/db';
import {
  fetchLeaderboard,
  isEligible,
  topByWindowPnl,
  type LeaderboardRow,
} from '@copytrade/hl-client';
import { MIN_ACCOUNT_VALUE_USD } from '@copytrade/scoring';
import { db } from '../db.js';
import { log } from '../log.js';
import { persistAndQueueLeaderboardRows } from './leaderboard-ingest.js';

/**
 * Scheduled poll of HL's official leaderboard, biased toward *curation
 * candidates*. Unlike `runLeaderboardIngest` (which sweeps a single window
 * broadly), this picks two sharper buckets:
 *
 *   1. Top-N by **7d ROI** (`week.roi` desc) — catches recent hot streaks
 *      that the all-time-PnL ranking misses.
 *   2. Top-N by **trader-ranking PnL** (`allTime.pnl` desc) — the steady
 *      long-tenure ranks that HL's own UI surfaces.
 *
 * The two sets are unioned/deduped, persisted into `wallets` with the HL
 * snapshot (tier-1, no fill history), and queued into `discovery_queue` so
 * `refresh-queue` can deep-ingest them; the next `score` run then evaluates
 * them against the curation gate (see jobs/score.ts).
 *
 * It *also* reconciles the **winner set** (= "Top Earners" on the home page):
 * HL's top-10 wallets by **7d realized PnL** that pass a lightweight noise
 * filter (the only fields a raw leaderboard row can support — account value,
 * 7d volume, ROI sanity). These ≤10 addresses get `wallets.winner = true` +
 * `winner_rank` 1..N (by 7d PnL desc), and they're the only wallets the
 * `ws-live-subscriber` holds a live WS subscription for. Display ordering on
 * the home page Top-Earners strip follows `winner_rank` directly (so the
 * biggest absolute earner leads — matching Hyperdash's `/explore/global`
 * 7d-PnL view). New winners are also queued for deep-ingest + scoring so
 * they pick up a composite for the secondary "Best to copy" surface.
 *
 * This job never deep-ingests inline — that's `refresh-queue`'s job. Cron
 * cadence: every 15 minutes.
 */

export interface LeaderboardPollOptions {
  /** Top-N rows by `week.roi` (7d ROI) to include. */
  topRoi?: number;
  /** Top-N rows by `allTime.pnl` (trader-ranking PnL) to include. */
  topRankers?: number;
  /** Eligibility floor: minimum current account value (USD). */
  minAccountValueUsd?: number;
  /** Eligibility floor: minimum 30d volume (USD). */
  minMonthlyVolumeUsd?: number;
}

// ── Winner-set noise filter ─────────────────────────────────────────────────
// What a *raw* HL leaderboard row can support — no ingested fill history yet.
// The account-value floor is the shared listing/curation floor (MIN_ACCOUNT_VALUE_USD,
// owned by @copytrade/scoring) — the winner set, the leaderboard list, and the
// curation gate all use the same number.
/** Min 7d volume (USD) for a winner — rejects tiny-account churners. */
const WINNER_MIN_7D_VOLUME_USD = 100_000;
/** ROI sanity: a 7d ROI above this (5000%/wk) is the $0→profit→withdraw / 100×-tiny-account garbage. */
const MAX_SANE_7D_ROI = 50;
/** How many winners the section holds. HL caps a WS connection at 10 unique users. */
const WINNER_LIMIT = 10;

function passesWinnerFilter(r: LeaderboardRow): boolean {
  if (!(r.accountValue >= MIN_ACCOUNT_VALUE_USD)) return false;
  if (!(r.week.vlm >= WINNER_MIN_7D_VOLUME_USD)) return false;
  const roi = r.week.roi;
  if (!Number.isFinite(roi)) return false;
  if (roi > MAX_SANE_7D_ROI) return false;
  return true;
}

export async function runLeaderboardPoll(opts: LeaderboardPollOptions = {}): Promise<void> {
  const topRoi = opts.topRoi ?? 100;
  const topRankers = opts.topRankers ?? 100;
  // Same floor as the leaderboard list / curation gate (one source of truth) —
  // no point deep-ingesting wallets that can never be listed.
  const minAccountValueUsd = opts.minAccountValueUsd ?? MIN_ACCOUNT_VALUE_USD;
  const minMonthlyVolumeUsd = opts.minMonthlyVolumeUsd ?? 10_000;

  const startedAt = Date.now();
  log.info({ topRoi, topRankers, minAccountValueUsd, minMonthlyVolumeUsd }, 'leaderboard-poll.start');

  const rawRows = await fetchLeaderboard();
  log.info({ totalRows: rawRows.length }, 'leaderboard-poll.fetched');

  const eligible = rawRows.filter((r) =>
    isEligible(r, { minAccountValueUsd, minMonthlyVolumeUsd }),
  );

  // Bucket 1: top by 7d ROI. `topByWindowPnl` sorts by *pnl*, not roi, so we
  // hand-roll the ROI sort. (Volume floor in `isEligible` already filters out
  // the $50-trade 1000x noise.)
  const topByRoi7d = [...eligible]
    .sort((a, b) => b.week.roi - a.week.roi)
    .slice(0, topRoi);

  // Bucket 2: top by all-time PnL (the "trader-rankers" the HL UI surfaces).
  const topByRanking = topByWindowPnl(eligible, 'allTime', topRankers);

  // Union/dedupe by address (lower-cased addrs come pre-normalized from hl-client).
  const byAddr = new Map<string, LeaderboardRow>();
  for (const r of topByRoi7d) byAddr.set(r.address, r);
  for (const r of topByRanking) byAddr.set(r.address, r);
  const candidates = [...byAddr.values()];

  log.info(
    {
      eligible: eligible.length,
      dropped: rawRows.length - eligible.length,
      topByRoi7d: topByRoi7d.length,
      topByRanking: topByRanking.length,
      deduped: candidates.length,
    },
    'leaderboard-poll.selected',
  );

  if (candidates.length === 0) {
    log.warn('leaderboard-poll.no_candidates');
    return;
  }

  const { walletsUpserted, queuedNew } = await persistAndQueueLeaderboardRows({
    toPersist: candidates,
    toQueue: candidates,
    source: 'hl_leaderboard_poll',
  });

  // ── Winner set: HL top-10 by 7d realized PnL, noise-filtered ──────────────
  // Walk *all* fetched rows sorted by 7d PnL desc (not just the eligible
  // bucket — the winner filter is its own, stricter gate that already cuts
  // small accounts via WINNER_MIN_7D_VOLUME_USD / MIN_ACCOUNT_VALUE_USD).
  // Apply the lightweight raw-row noise filter and take the first
  // WINNER_LIMIT that pass. Earlier code used `week.roi` — that pushed huge
  // absolute-PnL whales like Loracle ($14M / 32% ROI) below 100×-small-
  // account ROI scalpers; switching to `week.pnl` matches Hyperdash's
  // `/explore/global` 7d-PnL ranking, which is what users compare against.
  const sortedByPnl7d = [...rawRows].sort((a, b) => b.week.pnl - a.week.pnl);
  // Take a generous pre-pass against the raw HL snapshot, then drop any
  // wallet whose *live* equity (clearinghouseState via leader_cache) sits
  // below the floor. Symmetric with `score.ts`'s COALESCE gate input — HL
  // leaderboard snapshots keep showing peak equity long after a withdrawal,
  // so the snapshot alone admits "$11M historical / $128 live" winners.
  // Over-pull (WINNER_LIMIT * 3) so the live filter still has enough left.
  const winnerCandidates: LeaderboardRow[] = [];
  let evaluated = 0;
  for (const r of sortedByPnl7d) {
    evaluated += 1;
    if (passesWinnerFilter(r)) {
      winnerCandidates.push(r);
      if (winnerCandidates.length >= WINNER_LIMIT * 3) break;
    }
  }
  const winners = await filterWinnersByLiveEquity(winnerCandidates, WINNER_LIMIT);
  const droppedByLive = winnerCandidates.length - winners.length;

  const winnerStats = await reconcileWinners(winners);

  log.info(
    {
      walletsUpserted,
      queuedNew,
      winners: {
        evaluated,
        passed: winners.length,
        droppedByLiveEquity: droppedByLive,
        ranks: winners.map((r) => r.address),
        queuedNew: winnerStats.queuedNew,
      },
      ms: Date.now() - startedAt,
    },
    'leaderboard-poll.done',
  );
}

/**
 * Reject winner candidates whose live (clearinghouseState) equity has fallen
 * below the listing floor. HL's leaderboard snapshot keeps reporting peak
 * equity for hours after a withdrawal, so a wallet that traded a $10M
 * account up by +30% in 7d and then withdrew everything still shows up as
 * a top-PnL winner on the raw snapshot. Cross-checking `leader_cache` (kept
 * fresh by `leader-cache-poll` + `ws-live-subscriber`) drops those before
 * they reach `reconcileWinners`. Wallets without a cache row pass through —
 * they're new to the winner set and will be live-checked once the cohort
 * subscriber picks them up.
 */
async function filterWinnersByLiveEquity(
  candidates: LeaderboardRow[],
  limit: number,
): Promise<LeaderboardRow[]> {
  if (candidates.length === 0) return [];
  const addrs = candidates.map((r) => r.address);
  const cacheRows = await db()
    .select({ address: leaderCache.address, accountValue: leaderCache.accountValue })
    .from(leaderCache)
    .where(inArray(leaderCache.address, addrs));
  const liveByAddr = new Map<string, number | null>();
  for (const row of cacheRows) {
    const v = row.accountValue !== null ? Number.parseFloat(row.accountValue) : null;
    liveByAddr.set(row.address, Number.isFinite(v as number) ? (v as number) : null);
  }
  const out: LeaderboardRow[] = [];
  for (const r of candidates) {
    if (liveByAddr.has(r.address)) {
      const live = liveByAddr.get(r.address) ?? null;
      if (live === null || live < MIN_ACCOUNT_VALUE_USD) continue;
    }
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Make `wallets.winner` / `winner_rank` reflect exactly `winners` (in 7d-ROI
 * order, rank 1..N). Clears the previous set first so it's never cumulative.
 * Upserts each winner with fresh HL metrics, bumps `last_seen_at`, and queues
 * any *new* winner address into `discovery_queue` (they need a composite for
 * the section's display ordering).
 */
async function reconcileWinners(winners: LeaderboardRow[]): Promise<{ queuedNew: number }> {
  const now = new Date();

  // 1. Clear the previous winner set (so it's exactly the current top-N).
  await db().execute(sql`update ${wallets} set winner = false, winner_rank = null where winner`);

  if (winners.length === 0) return { queuedNew: 0 };

  // 2. Upsert each winner with rank + fresh HL metrics.
  for (let i = 0; i < winners.length; i++) {
    const r = winners[i]!;
    const rank = i + 1;
    await db()
      .insert(wallets)
      .values({
        address: r.address,
        firstSeenAt: now,
        lastSeenAt: now,
        accountValue: r.accountValue.toFixed(8),
        hlPnl1dUsd: r.day.pnl.toFixed(8),
        hlRoi1d: r.day.roi.toFixed(8),
        hlVolume1dUsd: r.day.vlm.toFixed(8),
        hlPnl7dUsd: r.week.pnl.toFixed(8),
        hlRoi7d: r.week.roi.toFixed(8),
        hlVolume7dUsd: r.week.vlm.toFixed(8),
        hlPnl30dUsd: r.month.pnl.toFixed(8),
        hlRoi30d: r.month.roi.toFixed(8),
        hlMetricsAt: now,
        winner: true,
        winnerRank: rank,
      })
      .onConflictDoUpdate({
        target: wallets.address,
        set: {
          lastSeenAt: sql`greatest(${wallets.lastSeenAt}, excluded.last_seen_at)`,
          accountValue: sql`excluded.account_value`,
          hlPnl1dUsd: sql`excluded.hl_pnl_1d_usd`,
          hlRoi1d: sql`excluded.hl_roi_1d`,
          hlVolume1dUsd: sql`excluded.hl_volume_1d_usd`,
          hlPnl7dUsd: sql`excluded.hl_pnl_7d_usd`,
          hlRoi7d: sql`excluded.hl_roi_7d`,
          hlVolume7dUsd: sql`excluded.hl_volume_7d_usd`,
          hlPnl30dUsd: sql`excluded.hl_pnl_30d_usd`,
          hlRoi30d: sql`excluded.hl_roi_30d`,
          hlMetricsAt: sql`excluded.hl_metrics_at`,
          winner: sql`true`,
          winnerRank: sql`excluded.winner_rank`,
          updatedAt: now,
        },
      });
  }

  // 3. Queue any *new* winner address for deep-ingest + scoring (so it gets a
  //    composite for the section ordering). `ingest_state` only ever moves
  //    forward — flip 'observed' → 'queued' for the freshly-queued ones.
  const winnerAddrs = winners.map((r) => r.address);
  const queued = await db()
    .insert(discoveryQueue)
    .values(winnerAddrs.map((address) => ({ address, source: 'hl_leaderboard_winner' })))
    .onConflictDoNothing({ target: discoveryQueue.address })
    .returning({ address: discoveryQueue.address });
  if (queued.length > 0) {
    const addresses = queued.map((q) => q.address);
    await db()
      .update(wallets)
      .set({ ingestState: 'queued' })
      .where(and(inArray(wallets.address, addresses), eq(wallets.ingestState, 'observed')));
  }

  return { queuedNew: queued.length };
}
