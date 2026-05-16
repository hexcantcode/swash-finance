import { setMaxListeners } from 'node:events';
import { sql } from 'drizzle-orm';
import { SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid';
import { fills, leaderCache, type NewFill } from '@copytrade/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { normalizeAddress } from '@copytrade/shared';
import type { NormalizedTrade } from '@copytrade/hl-client';
import { closeDb, db } from '../db.js';
import { hl } from '../hl.js';
import { log } from '../log.js';

/**
 * `trades-coin-subscriber` — the real-time backbone of the copytrading feed.
 *
 * Subscribes to Hyperliquid's per-coin `trades` channel for every perp in the
 * universe and filters incoming events against the `leaders` SQL VIEW —
 * the quality-filtered set (~69 today; see
 * docs/plans/2026-05-16-fills-retention-and-deepen.md). Older code referred
 * to this as the "tracked" set; we settled on "leaders" to match the
 * leader_cache / leader-detail terminology that's everywhere else.
 *
 * Why per-coin instead of per-user: HL hard-caps `userFills` subscriptions at
 * 10 unique users per source IP (verified empirically — see commit history).
 * That makes per-user WS structurally unusable for tracking 250+ wallets. The
 * `trades`-per-coin channel has no such cap and exposes every fill on every
 * subscribed coin, with `users: [maker, taker]` on every event.
 *
 * Sentinel-field caveat: HL's `trades` payload doesn't include `fee`,
 * `feeToken`, `closedPnl`, `oid`, `startPosition`, or `liquidationUser`. We
 * write rows with `fee='0'`, `feeToken='USDC'`, `closedPnl='0'`, etc., and
 * rely on REST/userFills enrichment to eventually overwrite those columns
 * with real values (via `onConflictDoUpdate` in the userFills writer). For
 * the ticker — which reads only (coin, side, px, sz, time, user) — these
 * sentinel rows render correctly the moment they land. For analytics, the
 * tail of fills <1min old may carry sentinels until the next REST cycle
 * fills them in; older history is always accurate.
 */

const TRACKED_REFRESH_SECONDS = 30;
const COIN_REFRESH_SECONDS = 6 * 60 * 60;
const HEARTBEAT_SECONDS = 60;
const SENTINEL_FEE = '0';
const SENTINEL_FEE_TOKEN = 'USDC';

const oppositeSide = (s: 'B' | 'A'): 'B' | 'A' => (s === 'B' ? 'A' : 'B');

const errMsg = (err: unknown): string => (err instanceof Error ? err.stack ?? err.message : String(err));

export async function runTradesCoinSubscriber(): Promise<void> {
  const transport = new WebSocketTransport({});
  const client = new SubscriptionClient({ transport });
  // `@nktkas/hyperliquid` routes all per-channel subscriptions through one
  // shared EventTarget; subscribing to ~150 coins blows past the default
  // 10-listener cap. Suppress the warning — these are intentional.
  setMaxListeners(0, (transport as unknown as { socket: { eventTarget?: EventTarget } }).socket?.eventTarget ?? process);
  const activeSubs = new Map<string, { unsubscribe(): Promise<void> }>();
  let leaders = new Set<string>();
  let stopping = false;
  let totalMatched = 0;
  let totalEvents = 0;

  log.info({}, 'trades-coin.start');

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log.info({ coins: activeSubs.size, totalMatched }, 'trades-coin.shutting_down');
    await Promise.allSettled(Array.from(activeSubs.values()).map((s) => s.unsubscribe()));
    activeSubs.clear();
    await transport.close().catch(() => {});
    await closeDb().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const refreshLeaders = async (): Promise<void> => {
    // Reads from the `leaders` SQL VIEW — see
    // packages/db/sql/2026-05-16-leaders-view-and-history.sql.
    const res = await db().execute<{ address: string }>(drizzleSql`SELECT address FROM leaders`);
    leaders = new Set(res.rows.map((r) => normalizeAddress(r.address)));
    log.debug({ leaders: leaders.size }, 'trades-coin.leaders_refreshed');
  };

  const refreshCoins = async (): Promise<void> => {
    // Main perp universe — bare coin names (e.g. "BTC", "HYPE").
    const meta = await hl().meta();
    const wanted = new Set(
      meta.data.universe.filter((u) => u.isDelisted !== true).map((u) => u.name),
    );
    // HIP-3 builder dex universes — prefixed as `dex:coin` (e.g. "xyz:SP500").
    // Probed empirically: HL's `trades` WS accepts these prefixed names just
    // like main-dex coins, and trade events come back with the prefixed `coin`
    // field. So one socket, one event handler, both feeds.
    let hip3Errors = 0;
    let hip3Count = 0;
    try {
      const dexList = await hl().perpDexs();
      const hip3Dexes = dexList.data.flatMap((d) => (d && d.name ? [d.name] : []));
      for (const dex of hip3Dexes) {
        try {
          const dexMeta = await hl().metaAndAssetCtxs({ dex });
          const universe = dexMeta.data[0]?.universe ?? [];
          for (const u of universe) {
            if (u.isDelisted === true) continue;
            // HL's `metaAndAssetCtxs({ dex })` returns names that may or may
            // not be prefixed (`vntl:ENERGY` vs. bare `ENERGY`). Normalize
            // defensively — same conditional-prefix rule the HIP-3 poll uses.
            const coin = u.name.includes(':') ? u.name : `${dex}:${u.name}`;
            wanted.add(coin);
            hip3Count += 1;
          }
        } catch (err) {
          hip3Errors += 1;
          log.warn({ dex, err: errMsg(err) }, 'trades-coin.hip3_meta_failed');
        }
      }
    } catch (err) {
      log.warn({ err: errMsg(err) }, 'trades-coin.hip3_dexes_failed');
    }

    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const c of wanted) if (!activeSubs.has(c)) toAdd.push(c);
    for (const c of activeSubs.keys()) if (!wanted.has(c)) toRemove.push(c);

    for (const coin of toAdd) {
      if (stopping) return;
      try {
        const sub = await client.trades({ coin }, (events) => {
          // The lib types the listener payload as `RecentTradesResponse` which
          // is an array — cast through unknown to our NormalizedTrade[] shape.
          void handleTrades(coin, events as unknown as NormalizedTrade[]).catch((err) =>
            log.warn({ coin, err: errMsg(err) }, 'trades-coin.handler_failed'),
          );
        });
        activeSubs.set(coin, sub);
      } catch (err) {
        log.warn({ coin, err: errMsg(err) }, 'trades-coin.subscribe_failed');
      }
    }
    for (const coin of toRemove) {
      const handle = activeSubs.get(coin);
      if (!handle) continue;
      await handle.unsubscribe().catch(() => {});
      activeSubs.delete(coin);
    }
    log.info(
      {
        universe: wanted.size,
        hip3Coins: hip3Count,
        hip3Errors,
        added: toAdd.length,
        removed: toRemove.length,
        total: activeSubs.size,
      },
      'trades-coin.coins_refreshed',
    );
  };

  const handleTrades = async (coin: string, events: NormalizedTrade[]): Promise<void> => {
    type Matched = { fill: NewFill; address: string; ts: number };
    const matched: Matched[] = [];
    const now = new Date();

    totalEvents += events.length;
    for (const t of events) {
      // HL `trades` event has `users: [maker, taker]`; we receive lowercase
      // hex strings from the lib but normalize defensively in case.
      const maker = normalizeAddress(t.users[0]);
      const taker = normalizeAddress(t.users[1]);
      const makerHit = leaders.has(maker);
      const takerHit = leaders.has(taker);
      if (!makerHit && !takerHit) continue;

      if (makerHit) {
        matched.push({
          address: maker,
          ts: t.time,
          fill: makeFill(maker, t, oppositeSide(t.side), false, now),
        });
      }
      if (takerHit) {
        matched.push({
          address: taker,
          ts: t.time,
          fill: makeFill(taker, t, t.side, true, now),
        });
      }
    }

    if (matched.length === 0) return;
    totalMatched += matched.length;

    // Write fills (one row per affected user per trade) — `onConflictDoNothing`
    // because REST/userFills owns enrichment of these rows.
    for (let i = 0; i < matched.length; i += 200) {
      await db()
        .insert(fills)
        .values(matched.slice(i, i + 200).map((m) => m.fill))
        .onConflictDoNothing({ target: [fills.tid, fills.userAddress] });
    }

    // Advance leader_cache.last_trade_ms per affected master/agent address.
    // Same pattern as ws-live's handleUserFills — preserves whatever's higher.
    const maxTsByAddress = new Map<string, number>();
    for (const m of matched) {
      const prev = maxTsByAddress.get(m.address) ?? 0;
      if (m.ts > prev) maxTsByAddress.set(m.address, m.ts);
    }
    for (const [address, ts] of maxTsByAddress) {
      await db()
        .insert(leaderCache)
        .values({ address, lastTradeMs: ts, source: 'ws', lastRefreshedAt: now })
        .onConflictDoUpdate({
          target: leaderCache.address,
          set: {
            lastTradeMs: sql`greatest(coalesce(${leaderCache.lastTradeMs}, 0), excluded.last_trade_ms)`,
          },
        });
    }

    log.debug({ coin, matched: matched.length, totalMatched }, 'trades-coin.matched');
  };

  // Initial bootstrap
  await refreshLeaders();
  await refreshCoins();

  // Periodic refresh loops — neither blocks the other; failures log and retry.
  const leadersLoop = (async () => {
    while (!stopping) {
      await sleep(TRACKED_REFRESH_SECONDS * 1000);
      if (stopping) break;
      try {
        await refreshLeaders();
      } catch (err) {
        log.warn({ err: errMsg(err) }, 'trades-coin.leaders_refresh_failed');
      }
    }
  })();
  const coinLoop = (async () => {
    while (!stopping) {
      await sleep(COIN_REFRESH_SECONDS * 1000);
      if (stopping) break;
      try {
        await refreshCoins();
      } catch (err) {
        log.warn({ err: errMsg(err) }, 'trades-coin.coin_refresh_failed');
      }
    }
  })();
  // Heartbeat — reports the firehose throughput at info level so operators
  // can see the job is alive and matching without querying the DB.
  const heartbeatLoop = (async () => {
    let prevEvents = 0;
    let prevMatched = 0;
    while (!stopping) {
      await sleep(HEARTBEAT_SECONDS * 1000);
      if (stopping) break;
      const dEvents = totalEvents - prevEvents;
      const dMatched = totalMatched - prevMatched;
      prevEvents = totalEvents;
      prevMatched = totalMatched;
      log.info(
        {
          coins: activeSubs.size,
          leaders: leaders.size,
          eventsThisMinute: dEvents,
          matchedThisMinute: dMatched,
          totalEvents,
          totalMatched,
        },
        'trades-coin.heartbeat',
      );
    }
  })();

  await Promise.race([leadersLoop, coinLoop, heartbeatLoop]);
}

function makeFill(
  address: string,
  t: NormalizedTrade,
  side: 'B' | 'A',
  crossed: boolean,
  now: Date,
): NewFill {
  return {
    tid: t.tid,
    userAddress: address,
    blockTimeMs: t.time,
    coin: t.coin,
    side,
    px: t.px,
    sz: t.sz,
    fee: SENTINEL_FEE,
    feeToken: SENTINEL_FEE_TOKEN,
    builderFee: '0',
    oid: null,
    hash: t.hash,
    crossed,
    closedPnl: '0',
    startPosition: null,
    liquidationUser: null,
    createdAt: now,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
