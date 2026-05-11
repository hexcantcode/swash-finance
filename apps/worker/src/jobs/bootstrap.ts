import { aggregateTrades, classifyCoin, buildAssetLookup } from '@copytrade/hl-client';
import { sql } from 'drizzle-orm';
import { discoveryQueue, wallets } from '@copytrade/db';
import { db } from '../db.js';
import { env } from '../env.js';
import { hl } from '../hl.js';
import { log } from '../log.js';

/**
 * One-shot discovery sweep. Subscribes to trades for the top N perp coins for
 * BOOTSTRAP_SWEEP_SECONDS, captures every wallet that traded, and queues each
 * one for fill ingestion in J-5.
 */
export async function runBootstrap(): Promise<void> {
  const e = env();
  const seconds = e.BOOTSTRAP_SWEEP_SECONDS;
  const topN = e.BOOTSTRAP_SWEEP_TOP_COINS;
  const start = Date.now();

  log.info({ seconds, topN }, 'bootstrap.start');

  const meta = await hl().meta();
  const perpDexs = await hl().perpDexs();
  const spotMeta = await hl().spotMeta();
  log.info(
    {
      perpUniverse: meta.data.universe.length,
      hip3Dexes: perpDexs.data.length,
      weight: meta.weightCost + perpDexs.weightCost + spotMeta.weightCost,
    },
    'bootstrap.meta_loaded',
  );

  // Pick the top N non-delisted main-dex perps in universe order.
  const topCoins = meta.data.universe
    .filter((u) => u.isDelisted !== true)
    .slice(0, topN)
    .map((u) => u.name);

  log.info({ coins: topCoins }, 'bootstrap.subscribing');

  const result = await aggregateTrades({
    coins: topCoins,
    durationMs: seconds * 1000,
  });

  log.info(
    { addresses: result.addresses.size, trades: result.tradeCount, ms: result.durationMs },
    'bootstrap.sweep_complete',
  );

  if (result.addresses.size === 0) {
    log.warn('bootstrap.no_addresses_found');
    return;
  }

  // Build the asset lookup so we can carry HIP-3 dex info into wallet rows
  // (informational only at this stage).
  const lookup = buildAssetLookup({
    meta: meta.data,
    perpDexs: perpDexs.data,
    spotMeta: spotMeta.data,
  });
  void lookup;
  void classifyCoin;

  const now = new Date();
  const walletRows = Array.from(result.addresses.values()).map((agg) => ({
    address: agg.address,
    firstSeenAt: new Date(agg.firstSeenMs),
    lastSeenAt: new Date(agg.lastSeenMs),
    totalFills: agg.fillCount,
    totalVolumeUsd: agg.totalNotional.toFixed(8),
  }));

  // Bulk upsert in chunks to keep statement size reasonable.
  const CHUNK = 500;
  for (let i = 0; i < walletRows.length; i += CHUNK) {
    const chunk = walletRows.slice(i, i + CHUNK);
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

  // Queue every observed address for J-5 to ingest fills.
  const queueRows = Array.from(result.addresses.keys()).map((address) => ({
    address,
    source: 'bootstrap_sweep',
    queuedAt: now,
  }));

  for (let i = 0; i < queueRows.length; i += CHUNK) {
    const chunk = queueRows.slice(i, i + CHUNK);
    await db()
      .insert(discoveryQueue)
      .values(chunk)
      .onConflictDoNothing({ target: discoveryQueue.address });
  }

  log.info(
    { walletsUpserted: walletRows.length, queued: queueRows.length, totalMs: Date.now() - start },
    'bootstrap.done',
  );
}
