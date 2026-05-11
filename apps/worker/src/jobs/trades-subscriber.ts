import { sql } from 'drizzle-orm';
import { wallets } from '@copytrade/db';
import { aggregateTrades, type NormalizedTrade } from '@copytrade/hl-client';
import { hl } from '../hl.js';
import { db } from '../db.js';
import { log } from '../log.js';

/**
 * Long-running WS subscriber that watches every fill on HL's top coins and
 * upserts a tier-1 wallet row for every observed address. This is the
 * "scan all HL wallets" path — the universe grows continuously without us
 * having to hit the leaderboard endpoint.
 *
 * Designed to run indefinitely. The aggregator we already have buffers
 * addresses in memory and only flushes when its duration expires, so we
 * wrap it in a periodic flush loop that writes batches every N seconds.
 *
 * Tier-1 only: this never queues addresses for deep ingest. The leaderboard
 * job and the referral endpoint do that.
 */

const FLUSH_SECONDS = 60;
const MAX_RUNTIME_MS = 0; // 0 = run forever

export async function runTradesSubscriber(opts: { topCoins?: number } = {}): Promise<void> {
  const topCoins = opts.topCoins ?? 20;
  const startedAt = Date.now();

  log.info({ topCoins, flushSeconds: FLUSH_SECONDS }, 'trades-subscriber.start');

  const meta = await hl().meta();
  const coins = meta.data.universe
    .filter((u) => u.isDelisted !== true)
    .slice(0, topCoins)
    .map((u) => u.name);

  log.info({ coins }, 'trades-subscriber.subscribing');

  // We restart the aggregator every FLUSH_SECONDS so its in-memory map
  // stays bounded and we get periodic batched writes.
  let totalFlushes = 0;
  let totalAddresses = 0;
  let totalTrades = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (MAX_RUNTIME_MS > 0 && Date.now() - startedAt > MAX_RUNTIME_MS) break;

    const flushResult = await aggregateTrades({
      coins,
      durationMs: FLUSH_SECONDS * 1000,
      onTrade: (t: NormalizedTrade) => {
        void t; // We persist on flush, not per-trade.
      },
    });

    if (flushResult.addresses.size > 0) {
      await flushAddresses(flushResult);
    }

    totalFlushes += 1;
    totalAddresses += flushResult.addresses.size;
    totalTrades += flushResult.tradeCount;

    log.info(
      {
        flush: totalFlushes,
        thisFlushAddresses: flushResult.addresses.size,
        thisFlushTrades: flushResult.tradeCount,
        totalAddresses,
        totalTrades,
      },
      'trades-subscriber.flush',
    );
  }

  log.info({ totalFlushes, totalAddresses, totalTrades }, 'trades-subscriber.stopped');
}

async function flushAddresses(
  result: Awaited<ReturnType<typeof aggregateTrades>>,
): Promise<void> {
  const now = new Date();
  const rows = Array.from(result.addresses.values()).map((agg) => ({
    address: agg.address,
    firstSeenAt: new Date(agg.firstSeenMs),
    lastSeenAt: new Date(agg.lastSeenMs),
    totalFills: agg.fillCount,
    totalVolumeUsd: agg.totalNotional.toFixed(8),
    ingestState: 'observed' as const,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db()
      .insert(wallets)
      .values(chunk)
      .onConflictDoUpdate({
        target: wallets.address,
        set: {
          lastSeenAt: sql`greatest(${wallets.lastSeenAt}, excluded.last_seen_at)`,
          totalFills: sql`${wallets.totalFills} + excluded.total_fills`,
          totalVolumeUsd: sql`${wallets.totalVolumeUsd} + excluded.total_volume_usd`,
          updatedAt: now,
        },
      });
  }
}
