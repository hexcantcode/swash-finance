import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid';
import type {
  UserFillsEvent,
  UserFundingsEvent,
  UserNonFundingLedgerUpdatesEvent,
  WebData2Event,
} from '@nktkas/hyperliquid/api/subscription';
import {
  fills,
  fundings,
  ledgerUpdates,
  leaderCache,
  wallets,
  type NewFill,
  type NewFunding,
  type NewLedgerUpdate,
} from '@copytrade/db';
import { MIN_ACCOUNT_VALUE_USD } from '@copytrade/scoring';
import { normalizeAddress } from '@copytrade/shared';
import { closeDb, db } from '../db.js';
import { hl } from '../hl.js';
import {
  preserveHip3OnMainWrite,
  replaceDexOnHip3Write,
} from '../lib/leader-cache-merge.js';
import { log } from '../log.js';

/**
 * `ws-live-subscriber` — long-running worker that tracks the **tracked set**
 * (top `TRACKED_LIMIT` wallets by HL 7d PnL passing the listing floor) and
 * holds per-user Hyperliquid WS subscriptions on each one, keeping the
 * live-tier cache (`leader_cache`) plus the history tables (`fills`/
 * `fundings`/`ledger_updates`) fresh in real time.
 *
 * Runs as its own process (like `trades-subscriber`) — NOT one of the
 * scheduled crons in `index.ts`. Launch via `pnpm --filter @copytrade/worker ws-live`.
 *
 * No backfill: the leaderboard-poll + refresh-queue + score flow already
 * ingests tracked candidates' history. This job only keeps the tail fresh.
 *
 * **The set.** Same listing floor the home-page leaderboard uses (one
 * source of truth): `is_agent = false`, `account_value >= $25k`,
 * `hl_pnl_7d_usd IS NOT NULL`, ordered by `hl_pnl_7d_usd DESC`, top
 * `TRACKED_LIMIT` (default 250). The previous version subscribed only to
 * the ≤10 winners — too narrow to catch HIP-3 holders and other deep
 * cohort activity. Hysteresis: an address is only *unsubscribed* once
 * it's been absent from the desired set for 2 consecutive reconcile
 * cycles, so a wallet that briefly drops out doesn't churn the pool.
 *
 * **Sharding.** Hyperliquid hard-caps each WS connection at 10 *unique users*
 * (not 10 subscriptions — one connection can hold 10 users × 4 subs = 40 subs).
 * With 250 users that's ~28 connections. Each shard is its own
 * `WebSocketTransport` + `SubscriptionClient` holding up to
 * `MAX_USERS_PER_CONNECTION` (= 9, one below the cap for a safety margin
 * against a reconnect-resubscribe race) distinct user addresses; the
 * reconcile loop diffs the desired set against the union of all shards'
 * users, places new users on a non-full shard (creating a new shard when
 * all are full), and drops users no longer wanted (closing a shard's
 * transport when it ends up empty).
 *
 * Each shard's `WebSocketTransport` auto-reconnects and auto-resubscribes
 * (`resubscribe` defaults to true) on connection drops, so we don't have to
 * re-issue that shard's subscriptions ourselves after a blip.
 */

const DEFAULT_RECONCILE_SECONDS = 60;

/**
 * Max distinct user addresses per WS connection. HL's hard cap is 10; we use 8
 * for a safety margin. A failed-mid-`Promise.allSettled` subscribe can briefly
 * leave a user registered on the HL side until we roll it back, and reconnect-
 * resubscribe can also double-count for a moment.
 */
const MAX_USERS_PER_CONNECTION = 8;

/**
 * Per-WS-request timeout (ms). Default in `@nktkas/hyperliquid` is 10s, which
 * is too tight when we burst ~32 subscribe requests (8 users × 4 channels) at
 * the same socket back-to-back during shard fill — HL's response queue can
 * fall behind. 30s gives the server room to drain.
 */
const WS_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Pause between consecutive users in a reconcile pass. Prevents bursting
 * subscribe requests faster than HL can ack them.
 */
const PER_USER_DELAY_MS = 100;

/**
 * How many tracked wallets to hold per-user WS subscriptions on. Matches the
 * leaderboard listing floor (`is_agent = false`, `account_value >= $25k`,
 * `hl_pnl_7d_usd IS NOT NULL`, ordered by 7d PnL desc). Overridable via env
 * `WS_TRACKED_LIMIT`. 250 → ~28 shards at 9 users each.
 */
const TRACKED_LIMIT = (() => {
  const raw = process.env['WS_TRACKED_LIMIT'];
  const n = raw ? Number.parseInt(raw, 10) : 250;
  return Number.isFinite(n) && n > 0 ? n : 250;
})();

/**
 * Unsubscribe hysteresis: only drop a subscribed address once it's been absent
 * from the desired set for this many consecutive reconcile cycles. Guards
 * against a winner that briefly blips out of `winner = true` (or a stale read)
 * churning the connection.
 */
const MAX_MISSED_CYCLES = 2;

/**
 * HIP-3 polling cadence. HL's `webData2` push only carries main-dex positions
 * — HIP-3 builder dexes (`xyz`, `cash`, …) require a per-dex REST poll. We
 * run this loop in parallel with the WS reconcile/event handlers, hitting
 * only the **HIP-3 cohort** (tracked wallets with HIP-3 fills in the recent
 * window OR currently holding any HIP-3 position) so we don't burn API
 * weight on crypto-only traders.
 */
const HIP3_POLL_SECONDS = 300;
/** Recency window for the HIP-3 cohort filter — a wallet enters the cohort
 *  once it has any `coin LIKE '%:%'` fill within this many days. */
const HIP3_COHORT_LOOKBACK_DAYS = 14;
/** Throttle between consecutive per-dex calls in a single poll pass.
 *  N(cohort) × N(dexes) calls per cycle; 100 ms keeps total weight to
 *  ~120/min even at the worst case. */
const HIP3_PER_CALL_DELAY_MS = 100;
/** How long the cached HIP-3 dex list stays valid before we re-fetch
 *  `info.perpDexs()`. 6h means a newly-listed HL builder dex lands inside
 *  a single trading session without needing a worker restart. */
const HIP3_DEX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface UserSubs {
  webData2: { unsubscribe(): Promise<void> };
  userFills: { unsubscribe(): Promise<void> };
  userFundings: { unsubscribe(): Promise<void> };
  userLedger: { unsubscribe(): Promise<void> };
}

interface Shard {
  transport: WebSocketTransport;
  client: SubscriptionClient;
  /** address -> 4 subscription handles. `size` is the unique-user count. */
  users: Map<string, UserSubs>;
}

function newShard(): Shard {
  const transport = new WebSocketTransport({ timeout: WS_REQUEST_TIMEOUT_MS });
  const client = new SubscriptionClient({ transport });
  return { transport, client, users: new Map() };
}

export async function runWsLiveSubscriber(
  opts: { reconcileSeconds?: number } = {},
): Promise<void> {
  const reconcileSeconds = opts.reconcileSeconds ?? DEFAULT_RECONCILE_SECONDS;

  /** Connection pool. Each shard holds <= MAX_USERS_PER_CONNECTION users. */
  const shards: Shard[] = [];
  /** Per-subscribed-address count of consecutive reconcile cycles it's been absent from the desired set. */
  const missedCycles = new Map<string, number>();

  log.info({ reconcileSeconds, maxUsersPerConnection: MAX_USERS_PER_CONNECTION }, 'ws-live.start');

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const totalUsers = shards.reduce((n, s) => n + s.users.size, 0);
    log.info({ shards: shards.length, totalUsers }, 'ws-live.shutting_down');
    for (const shard of shards) {
      await Promise.allSettled(
        Array.from(shard.users.values()).flatMap((s) => [
          s.webData2.unsubscribe(),
          s.userFills.unsubscribe(),
          s.userFundings.unsubscribe(),
          s.userLedger.unsubscribe(),
        ]),
      );
      shard.users.clear();
      await shard.transport.close().catch(() => {});
    }
    shards.length = 0;
    await closeDb().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // HIP-3 dex list — cached for `HIP3_DEX_CACHE_TTL_MS`. Refreshed lazily
  // at the start of each poll cycle so a newly-listed builder dex shows up
  // within one TTL without a worker restart. Failure here doesn't block the
  // WS loop; the cycle just skips HIP-3 polling and tries again.
  const hip3DexCache: { names: string[]; fetchedAt: number } = {
    names: [],
    fetchedAt: 0,
  };
  const ensureHip3DexNames = async (): Promise<string[]> => {
    if (
      hip3DexCache.names.length > 0 &&
      Date.now() - hip3DexCache.fetchedAt < HIP3_DEX_CACHE_TTL_MS
    ) {
      return hip3DexCache.names;
    }
    try {
      const resp = await hl().perpDexs();
      const fresh = resp.data.flatMap((d) => (d && d.name ? [d.name] : []));
      const prev = hip3DexCache.names;
      hip3DexCache.names = fresh;
      hip3DexCache.fetchedAt = Date.now();
      const added = fresh.filter((d) => !prev.includes(d));
      const removed = prev.filter((d) => !fresh.includes(d));
      log.info({ hip3Dexes: fresh, added, removed }, 'ws-live.hip3_dexes_refreshed');
    } catch (err) {
      log.warn({ err: errMsg(err) }, 'ws-live.hip3_dexes_fetch_failed');
    }
    return hip3DexCache.names;
  };

  // HIP-3 polling loop — runs in parallel with reconcile. A failure inside
  // shouldn't kill the WS work; everything is caught at the cycle level.
  // Cadence model matches `leader-cache-poll`: sleep = max(0, interval -
  // elapsed) so cadence stays anchored to interval boundaries instead of
  // drifting later on slow cycles. A cycle that runs longer than the
  // interval logs a warning and starts the next cycle immediately.
  const hip3Loop = (async () => {
    while (!stopping) {
      const cycleStart = Date.now();
      const hip3DexNames = await ensureHip3DexNames();
      if (hip3DexNames.length > 0) {
        try {
          await runHip3PollOnce(hip3DexNames, () => stopping);
        } catch (err) {
          log.warn({ err: errMsg(err) }, 'ws-live.hip3_poll_failed');
        }
      }
      const elapsedMs = Date.now() - cycleStart;
      const intervalMs = HIP3_POLL_SECONDS * 1000;
      const sleepMs = Math.max(0, intervalMs - elapsedMs);
      if (sleepMs === 0 && elapsedMs > intervalMs) {
        log.warn({ elapsedMs, intervalMs }, 'ws-live.hip3_poll_cycle_overran');
      }
      if (!stopping && sleepMs > 0) await sleep(sleepMs);
    }
  })();

  // Reconciliation loop: keep the subscription pool in sync with the winner set.
  while (!stopping) {
    try {
      await reconcileOnce(shards, missedCycles, () => stopping);
    } catch (err) {
      log.warn({ err: errMsg(err) }, 'ws-live.reconcile_failed');
    }
    await sleep(reconcileSeconds * 1000);
  }

  await hip3Loop.catch(() => {});
}

/** Find the shard currently holding `address`, or undefined. */
function findShardFor(shards: Shard[], address: string): Shard | undefined {
  return shards.find((s) => s.users.has(address));
}

async function reconcileOnce(
  shards: Shard[],
  missedCycles: Map<string, number>,
  isStopping: () => boolean,
): Promise<void> {
  // The desired set is the leaderboard listing floor — same one the
  // home-page table uses (single source of truth): `is_agent = false`,
  // `account_value >= MIN_ACCOUNT_VALUE_USD`, `hl_pnl_7d_usd IS NOT NULL`,
  // ranked by HL 7d PnL desc, top `TRACKED_LIMIT`. Catches HIP-3 holders
  // and other cohort activity that the old `winner = true` (≤10) gate
  // would miss.
  const rows = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(
      and(
        eq(wallets.isAgent, false),
        isNotNull(wallets.hlPnl7dUsd),
        sql`${wallets.accountValue} >= ${MIN_ACCOUNT_VALUE_USD}`,
      ),
    )
    .orderBy(desc(wallets.hlPnl7dUsd))
    .limit(TRACKED_LIMIT);
  // Use the master address — for v1 we subscribe to masters only.
  // TODO: also subscribe to winners' agent addresses (resolve via extraAgents /
  // `wallets.master_address` links) so agent-only activity is attributed to the
  // master in real time.
  const desired = new Set<string>(rows.map((r) => normalizeAddress(r.address)));

  let added = 0;
  let removed = 0;

  // Subscribe new winner addresses, placing each on a non-full shard
  // (spinning up a new shard/connection when every existing shard is full).
  for (const address of desired) {
    if (isStopping()) return;
    missedCycles.delete(address);
    if (findShardFor(shards, address)) continue;
    let shard = shards.find((s) => s.users.size < MAX_USERS_PER_CONNECTION);
    if (!shard) {
      shard = newShard();
      shards.push(shard);
    }
    try {
      const subs = await subscribeUser(shard.client, address);
      shard.users.set(address, subs);
      added += 1;
    } catch (err) {
      // With MAX_USERS_PER_CONNECTION = 8 the "Cannot track more than 10 unique
      // users" error shouldn't happen — log and move on if it somehow does.
      log.warn({ address, err: errMsg(err) }, 'ws-live.subscribe_failed');
      // If a brand-new shard failed on its first user, drop it so we retry next cycle.
      if (shard.users.size === 0 && shards[shards.length - 1] === shard) {
        shards.pop();
        await shard.transport.close().catch(() => {});
      }
    }
    // Pace requests so HL's response queue can drain — bursting 4 subscribes
    // per user against the same socket back-to-back triggers timeouts.
    if (added > 0 && !isStopping()) await sleep(PER_USER_DELAY_MS);
  }

  // Unsubscribe addresses no longer in the desired set — but only after they've
  // been absent for MAX_MISSED_CYCLES consecutive reconciles (hysteresis).
  for (const shard of shards) {
    for (const [address, subs] of Array.from(shard.users.entries())) {
      if (desired.has(address)) continue;
      const missed = (missedCycles.get(address) ?? 0) + 1;
      if (missed < MAX_MISSED_CYCLES) {
        missedCycles.set(address, missed);
        continue;
      }
      await Promise.allSettled([
        subs.webData2.unsubscribe(),
        subs.userFills.unsubscribe(),
        subs.userFundings.unsubscribe(),
        subs.userLedger.unsubscribe(),
      ]);
      shard.users.delete(address);
      missedCycles.delete(address);
      removed += 1;
    }
  }
  for (let i = shards.length - 1; i >= 0; i--) {
    const shard = shards[i]!;
    if (shard.users.size === 0) {
      shards.splice(i, 1);
      await shard.transport.close().catch(() => {});
    }
  }

  const totalUsers = shards.reduce((n, s) => n + s.users.size, 0);
  log.info(
    { winners: desired.size, added, removed, pendingDrop: missedCycles.size, shards: shards.length, totalUsers },
    'ws-live.reconciled',
  );
}

/**
 * Subscribe a user to all 4 channels on the given shard's client.
 *
 * Channels go one at a time (not `Promise.all`) so we know exactly which
 * subscriptions are live at any moment. If any channel throws, we roll back
 * the ones that already succeeded — `_subscriptionManager._countUniqueUsers`
 * is incremented on the **first successful** channel for an address, so
 * leaving partial subscriptions behind would burn one of the shard's 10
 * user slots even though our own `users` map shows 0.
 */
async function subscribeUser(
  client: SubscriptionClient,
  address: string,
): Promise<UserSubs> {
  const user = address as `0x${string}`;
  const acquired: Array<{ unsubscribe(): Promise<void> }> = [];
  try {
    const webData2Sub = await client.webData2({ user }, (data) => {
      void handleWebData2(address, data).catch((err) =>
        log.warn({ address, err: errMsg(err) }, 'ws-live.webData2_handler_failed'),
      );
    });
    acquired.push(webData2Sub);
    const userFillsSub = await client.userFills({ user }, (data) => {
      void handleUserFills(data).catch((err) =>
        log.warn({ address, err: errMsg(err) }, 'ws-live.userFills_handler_failed'),
      );
    });
    acquired.push(userFillsSub);
    const userFundingsSub = await client.userFundings({ user }, (data) => {
      void handleUserFundings(data).catch((err) =>
        log.warn({ address, err: errMsg(err) }, 'ws-live.userFundings_handler_failed'),
      );
    });
    acquired.push(userFundingsSub);
    const userLedgerSub = await client.userNonFundingLedgerUpdates({ user }, (data) => {
      void handleUserLedger(data).catch((err) =>
        log.warn({ address, err: errMsg(err) }, 'ws-live.userLedger_handler_failed'),
      );
    });
    acquired.push(userLedgerSub);
    return {
      webData2: webData2Sub,
      userFills: userFillsSub,
      userFundings: userFundingsSub,
      userLedger: userLedgerSub,
    };
  } catch (err) {
    // Roll back partial successes so the manager's unique-user count drops
    // back to where it was before this attempt. allSettled — we want to try
    // every unsub even if one fails.
    await Promise.allSettled(acquired.map((s) => s.unsubscribe()));
    throw err;
  }
}

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * `webData2` push → upsert the live-tier columns this job owns on
 * `leader_cache`: account_value / margin_used / leverage / positions_json /
 * source / last_refreshed_at / last_refresh_source. It does NOT touch
 * `last_trade_ms` (owned by the userFills handler) nor recent_fills_json /
 * funding_30d_json / ledger_30d_json (owned by the REST refresh path).
 *
 * `positions_json` merge: the WS push only carries main-dex positions, but
 * the column also stores HIP-3 positions written by `runHip3PollOnce`. The
 * conflict update keeps any existing HIP-3 entries (coin contains a `:`)
 * from the prior row and concatenates the new main-dex array — so the
 * push doesn't clobber HIP-3 state.
 */
async function handleWebData2(rawAddress: string, data: WebData2Event): Promise<void> {
  const address = normalizeAddress(rawAddress);
  const cs = data.clearinghouseState;
  const accountValueStr = cs.marginSummary.accountValue;
  const marginUsedStr = cs.marginSummary.totalMarginUsed;
  const accountValue = Number.parseFloat(accountValueStr);
  const totalNtlPos = Number.parseFloat(cs.marginSummary.totalNtlPos);
  // Account-level GROSS leverage = total notional position / account value
  // (NOT per-position leverage). Null when account value is zero/invalid.
  const leverage =
    Number.isFinite(accountValue) && accountValue > 0 && Number.isFinite(totalNtlPos)
      ? clampLeverage(totalNtlPos / accountValue)
      : null;

  const now = new Date();
  await db()
    .insert(leaderCache)
    .values({
      address,
      accountValue: Number.isFinite(accountValue) ? accountValueStr : null,
      marginUsed: Number.isFinite(Number.parseFloat(marginUsedStr)) ? marginUsedStr : null,
      leverage,
      // Store the raw assetPositions array — `parseOpenPositions` consumes this shape.
      positionsJson: cs.assetPositions,
      source: 'ws',
      lastRefreshedAt: now,
      lastRefreshSource: 'ws',
    })
    .onConflictDoUpdate({
      target: leaderCache.address,
      set: {
        accountValue: sql`excluded.account_value`,
        marginUsed: sql`excluded.margin_used`,
        leverage: sql`excluded.leverage`,
        // Preserve any HIP-3 entries written by the per-dex poller — see
        // `preserveHip3OnMainWrite()`. Shared merge contract; the REST
        // `leader-cache-poll` writer uses the same helper.
        positionsJson: preserveHip3OnMainWrite(),
        source: sql`excluded.source`,
        lastRefreshedAt: sql`excluded.last_refreshed_at`,
        lastRefreshSource: sql`excluded.last_refresh_source`,
      },
    });
}

/**
 * `userFills` push (may be a snapshot — handled the same way; idempotent
 * inserts make it safe). Inserts each fill into `fills` (conflict target
 * `(tid, user_address)` — the table PK), then advances
 * `leader_cache.last_trade_ms` (this handler owns that column) and bumps
 * `wallets.last_seen_at` (the internal discovery signal).
 */
async function handleUserFills(data: UserFillsEvent): Promise<void> {
  const fillList = data.fills;
  if (fillList.length === 0) return;
  const address = normalizeAddress(data.user);
  const now = new Date();

  const rows: NewFill[] = fillList.map((f) => ({
    tid: f.tid,
    userAddress: address,
    blockTimeMs: f.time,
    coin: f.coin,
    side: f.side,
    px: f.px,
    sz: f.sz,
    fee: f.fee,
    feeToken: f.feeToken,
    builderFee: f.builderFee ?? '0',
    oid: f.oid,
    hash: f.hash,
    crossed: f.crossed,
    closedPnl: f.closedPnl,
    startPosition: f.startPosition,
    liquidationUser: f.liquidation?.liquidatedUser ?? null,
    createdAt: now,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const out = await db()
      .insert(fills)
      .values(rows.slice(i, i + 200))
      .onConflictDoNothing({ target: [fills.tid, fills.userAddress] })
      .returning({ tid: fills.tid });
    inserted += out.length;
  }

  const maxTime = fillList.reduce((m, f) => (f.time > m ? f.time : m), 0);

  // Advance last_trade_ms (upsert in case the webData2 push hasn't created the row yet).
  await db()
    .insert(leaderCache)
    .values({ address, lastTradeMs: maxTime, source: 'ws', lastRefreshedAt: now })
    .onConflictDoUpdate({
      target: leaderCache.address,
      set: {
        lastTradeMs: sql`greatest(coalesce(${leaderCache.lastTradeMs}, 0), excluded.last_trade_ms)`,
      },
    });

  // Bump the internal discovery signal.
  await db().execute(sql`
    update wallets
    set last_seen_at = greatest(last_seen_at, to_timestamp(${maxTime} / 1000.0)), updated_at = now()
    where address = ${address}
  `);

  log.debug({ address, inserted, maxTime }, 'ws-live.fills');
}

/** `userFundings` push → idempotent insert into `fundings` (conflict on `(user_address, block_time_ms, coin)`). */
async function handleUserFundings(data: UserFundingsEvent): Promise<void> {
  const list = data.fundings;
  if (list.length === 0) return;
  const address = normalizeAddress(data.user);
  const now = new Date();

  const rows: NewFunding[] = list.map((f) => ({
    userAddress: address,
    blockTimeMs: f.time,
    coin: f.coin,
    usdc: f.usdc,
    szi: f.szi,
    fundingRate: f.fundingRate,
    createdAt: now,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const out = await db()
      .insert(fundings)
      .values(rows.slice(i, i + 200))
      .onConflictDoNothing({
        target: [fundings.userAddress, fundings.blockTimeMs, fundings.coin],
      })
      .returning({ id: fundings.id });
    inserted += out.length;
  }
  log.debug({ address, inserted }, 'ws-live.fundings');
}

/**
 * `userNonFundingLedgerUpdates` push → idempotent insert into `ledger_updates`
 * (conflict on `(hash, user_address, type)`). HL ledger update types include
 * deposit / withdraw / accountClassTransfer / internalTransfer /
 * subAccountTransfer / vaultDeposit / vaultWithdraw / spotTransfer / liquidation
 * / rewardsClaim etc. — we store `type` + `usdc` (when present) like
 * `ingest-wallet.ts`; the scoring path filters which types matter.
 */
async function handleUserLedger(data: UserNonFundingLedgerUpdatesEvent): Promise<void> {
  const list = data.nonFundingLedgerUpdates;
  if (list.length === 0) return;
  const address = normalizeAddress(data.user);
  const now = new Date();

  const rows: NewLedgerUpdate[] = list.map((l) => {
    const details = l.delta as unknown as Record<string, unknown>;
    const usdc = typeof details['usdc'] === 'string' ? (details['usdc'] as string) : null;
    const type = typeof details['type'] === 'string' ? (details['type'] as string) : 'unknown';
    return {
      userAddress: address,
      blockTimeMs: l.time,
      hash: l.hash,
      type,
      usdc,
      detailsJson: details,
      createdAt: now,
    };
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const out = await db()
      .insert(ledgerUpdates)
      .values(rows.slice(i, i + 200))
      .onConflictDoNothing({
        target: [ledgerUpdates.hash, ledgerUpdates.userAddress, ledgerUpdates.type],
      })
      .returning({ id: ledgerUpdates.id });
    inserted += out.length;
  }
  log.debug({ address, inserted }, 'ws-live.ledger');
}

// ── HIP-3 polling ──────────────────────────────────────────────────────────

/**
 * One HIP-3 poll pass. Walks the **HIP-3 cohort** — wallets in the canonical
 * tracked set (same listing-floor query the home-page leaderboard and the
 * REST `leader-cache-poll` companion use, single source of truth) AND with
 * at least one `coin LIKE '%:%'` fill in the last `HIP3_COHORT_LOOKBACK_DAYS`
 * days — and for each (address, hip3 dex) pair calls `clearinghouseState`
 * on that dex, then merges into `leader_cache.positions_json` preserving
 * everything from other dexes / main. Coin names returned by HL may or may
 * not include the `dex:` prefix depending on the API; we defensively
 * normalize to `dex:SYMBOL` so the downstream queries that key on
 * `coin LIKE '%:%'` always see prefixed names.
 */
async function runHip3PollOnce(
  hip3DexNames: string[],
  isStopping: () => boolean,
): Promise<void> {
  // Canonical tracked set — must match `ws-live-subscriber.reconcileOnce` +
  // `leader-cache-poll.pollOnce`. Drawing from the DB (not WS shard state)
  // means a wallet that briefly drops off a shard during reconcile still
  // gets HIP-3 polled, and the loop starts producing data before the WS
  // pool is fully filled.
  //
  // Cohort = tracked ∩ (recent-HIP-3-fill ∪ current-HIP-3-holder). The
  // holder branch covers stale wallets that haven't traded HIP-3 in the
  // lookback window but still hold an open position — without it, those
  // positions would never refresh and could go stale or fall out of sync
  // when the trader closes via fills we didn't observe.
  const cutoffMs = Date.now() - HIP3_COHORT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const cohortResp = await db().execute<{ address: string }>(sql`
    with tracked as (
      select address
      from ${wallets}
      where ${wallets.isAgent} = false
        and ${wallets.hlPnl7dUsd} is not null
        and ${wallets.accountValue} >= ${MIN_ACCOUNT_VALUE_USD}
      order by ${wallets.hlPnl7dUsd} desc nulls last
      limit ${TRACKED_LIMIT}
    )
    select t.address
    from tracked t
    where exists (
      select 1 from ${fills} f
      where f.user_address = t.address
        and f.coin like '%:%'
        and f.block_time_ms >= ${cutoffMs}
    )
    or exists (
      select 1 from ${leaderCache} lc,
           lateral jsonb_array_elements(lc.positions_json) as p(elem)
      where lc.address = t.address
        and (p.elem -> 'position' ->> 'coin') like '%:%'
    )
  `);
  const cohort = cohortResp.rows.map((r) => normalizeAddress(r.address));
  if (cohort.length === 0) {
    log.info({}, 'ws-live.hip3_poll_no_cohort');
    return;
  }

  let polled = 0;
  let positionsWritten = 0;
  let failed = 0;
  for (const address of cohort) {
    for (const dexName of hip3DexNames) {
      if (isStopping()) return;
      try {
        const positionCount = await pollHip3ForAddress(address, dexName);
        positionsWritten += positionCount;
        polled += 1;
      } catch (err) {
        failed += 1;
        log.debug(
          { address, dex: dexName, err: errMsg(err) },
          'ws-live.hip3_poll_call_failed',
        );
      }
      if (!isStopping()) await sleep(HIP3_PER_CALL_DELAY_MS);
    }
  }
  log.info(
    { cohort: cohort.length, dexes: hip3DexNames.length, polled, failed, positionsWritten },
    'ws-live.hip3_polled',
  );
}

async function pollHip3ForAddress(address: string, dexName: string): Promise<number> {
  const res = await hl().clearinghouseState(address, { dex: dexName });
  const raw = res.data.assetPositions;

  // Normalize: prefix bare symbols with `${dexName}:` so the storage format
  // is always `dex:SYMBOL`. If HL already returns it prefixed, the includes
  // check is a no-op.
  const normalized = raw.map((ap) => ({
    ...ap,
    position: {
      ...ap.position,
      coin: ap.position.coin.includes(':') ? ap.position.coin : `${dexName}:${ap.position.coin}`,
    },
  }));

  await db()
    .insert(leaderCache)
    .values({
      address,
      positionsJson: normalized,
      lastRefreshedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: leaderCache.address,
      set: {
        // Drop existing entries for this dex, append the fresh array. See
        // `replaceDexOnHip3Write()`; other dexes / main-dex survive.
        positionsJson: replaceDexOnHip3Write(dexName),
        // Don't bump source / last_refresh_source — those track the main-dex
        // freshness (owned by the WS handler). Don't touch account_value /
        // margin_used / leverage either — those are main-dex summary numbers.
      },
    });

  return normalized.length;
}

// ── helpers ────────────────────────────────────────────────────────────────

const LEVERAGE_MAX = 9999;

/** leader_cache.leverage is numeric(20,4); clamp absurd values like score.ts's numToStr does. */
function clampLeverage(value: number): string {
  if (!Number.isFinite(value)) return '0.0000';
  const clamped = Math.max(-LEVERAGE_MAX, Math.min(LEVERAGE_MAX, value));
  return clamped.toFixed(4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
