import { sql } from 'drizzle-orm';
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
import { normalizeAddress } from '@copytrade/shared';
import { closeDb, db } from '../db.js';
import { log } from '../log.js';

/**
 * `ws-live-subscriber` — long-running worker that holds per-user Hyperliquid
 * WS subscriptions for every `curated` wallet and keeps the live-tier cache
 * (`leader_cache`) plus the history tables (`fills`/`fundings`/`ledger_updates`)
 * fresh in real time.
 *
 * Runs as its own process (like `trades-subscriber`) — NOT one of the
 * scheduled crons in `index.ts`. Launch via `pnpm --filter @copytrade/worker ws-live`.
 *
 * No backfill: the leaderboard-poll + refresh-queue + score flow already
 * ingests curated candidates' history before they can score >= 70 (and thus
 * before they become `curated`). This job only keeps the tail fresh.
 *
 * **Sharding.** Hyperliquid hard-caps each WS connection at 10 *unique users*
 * (not 10 subscriptions — one connection can hold 10 users × 4 subs = 40 subs).
 * So we maintain a *pool* of shards: each shard is its own `WebSocketTransport`
 * + `SubscriptionClient` holding up to `MAX_USERS_PER_CONNECTION` (= 9, one
 * below the cap for a safety margin against a reconnect-resubscribe race)
 * distinct user addresses. The reconcile loop diffs `wallets.curated` against
 * the union of all shards' users, places new users on a non-full shard
 * (creating a new shard when all are full), and drops users that are no longer
 * curated (closing a shard's transport when it ends up empty).
 *
 * Each shard's `WebSocketTransport` auto-reconnects and auto-resubscribes
 * (`resubscribe` defaults to true) on connection drops, so we don't have to
 * re-issue that shard's subscriptions ourselves after a blip.
 */

const DEFAULT_RECONCILE_SECONDS = 60;

/**
 * Max distinct user addresses per WS connection. HL's hard cap is 10; we use 9
 * for a safety margin (a reconnect-resubscribe race could briefly double-count).
 */
const MAX_USERS_PER_CONNECTION = 9;

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
  const transport = new WebSocketTransport();
  const client = new SubscriptionClient({ transport });
  return { transport, client, users: new Map() };
}

export async function runWsLiveSubscriber(
  opts: { reconcileSeconds?: number } = {},
): Promise<void> {
  const reconcileSeconds = opts.reconcileSeconds ?? DEFAULT_RECONCILE_SECONDS;

  /** Connection pool. Each shard holds <= MAX_USERS_PER_CONNECTION users. */
  const shards: Shard[] = [];

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

  // Reconciliation loop: keep the subscription pool in sync with `wallets.curated`.
  while (!stopping) {
    try {
      await reconcileOnce(shards, () => stopping);
    } catch (err) {
      log.warn({ err: errMsg(err) }, 'ws-live.reconcile_failed');
    }
    await sleep(reconcileSeconds * 1000);
  }
}

/** Find the shard currently holding `address`, or undefined. */
function findShardFor(shards: Shard[], address: string): Shard | undefined {
  return shards.find((s) => s.users.has(address));
}

async function reconcileOnce(shards: Shard[], isStopping: () => boolean): Promise<void> {
  const rows = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(sql`${wallets.curated} = true`);
  // Use the master address — for v1 we subscribe to masters only.
  // TODO: also subscribe to curated wallets' agent addresses (resolve via
  // extraAgents / `wallets.master_address` links) so agent-only activity is
  // attributed to the master in real time.
  const desired = new Set<string>(rows.map((r) => normalizeAddress(r.address)));

  let added = 0;
  let removed = 0;

  // Subscribe newly-curated addresses, placing each on a non-full shard
  // (spinning up a new shard/connection when every existing shard is full).
  for (const address of desired) {
    if (isStopping()) return;
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
      // With MAX_USERS_PER_CONNECTION = 9 the "Cannot track more than 10 unique
      // users" error shouldn't happen — log and move on if it somehow does.
      log.warn({ address, err: errMsg(err) }, 'ws-live.subscribe_failed');
      // If a brand-new shard failed on its first user, drop it so we retry next cycle.
      if (shard.users.size === 0 && shards[shards.length - 1] === shard) {
        shards.pop();
        await shard.transport.close().catch(() => {});
      }
    }
  }

  // Unsubscribe addresses no longer curated; drop a shard once it's empty.
  for (const shard of shards) {
    for (const [address, subs] of Array.from(shard.users.entries())) {
      if (desired.has(address)) continue;
      await Promise.allSettled([
        subs.webData2.unsubscribe(),
        subs.userFills.unsubscribe(),
        subs.userFundings.unsubscribe(),
        subs.userLedger.unsubscribe(),
      ]);
      shard.users.delete(address);
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
    { curated: desired.size, added, removed, shards: shards.length, totalUsers },
    'ws-live.reconciled',
  );
}

async function subscribeUser(
  client: SubscriptionClient,
  address: string,
): Promise<UserSubs> {
  const user = address as `0x${string}`;
  const [webData2Sub, userFillsSub, userFundingsSub, userLedgerSub] = await Promise.all([
    client.webData2({ user }, (data) => {
      void handleWebData2(address, data).catch((err) =>
        log.warn({ address, err: errMsg(err) }, 'ws-live.webData2_handler_failed'),
      );
    }),
    client.userFills({ user }, (data) => {
      void handleUserFills(data).catch((err) =>
        log.warn({ address, err: errMsg(err) }, 'ws-live.userFills_handler_failed'),
      );
    }),
    client.userFundings({ user }, (data) => {
      void handleUserFundings(data).catch((err) =>
        log.warn({ address, err: errMsg(err) }, 'ws-live.userFundings_handler_failed'),
      );
    }),
    client.userNonFundingLedgerUpdates({ user }, (data) => {
      void handleUserLedger(data).catch((err) =>
        log.warn({ address, err: errMsg(err) }, 'ws-live.userLedger_handler_failed'),
      );
    }),
  ]);
  return {
    webData2: webData2Sub,
    userFills: userFillsSub,
    userFundings: userFundingsSub,
    userLedger: userLedgerSub,
  };
}

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * `webData2` push → upsert the live-tier columns this job owns on
 * `leader_cache`: account_value / margin_used / leverage / positions_json /
 * source / last_refreshed_at / last_refresh_source. It does NOT touch
 * `last_trade_ms` (owned by the userFills handler) nor recent_fills_json /
 * funding_30d_json / ledger_30d_json (owned by the REST refresh path).
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
        positionsJson: sql`excluded.positions_json`,
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
