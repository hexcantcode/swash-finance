import { and, asc, eq } from 'drizzle-orm';
import { discoveryQueue } from '@copytrade/db';
import { db } from '../db.js';
import { log } from '../log.js';
import { ingestWallet } from '../services/ingest-wallet.js';

const BATCH_SIZE = 5;

/**
 * J-5: pop pending discovery_queue items and ingest each wallet's fill
 * history (plus its agents'). Idempotent — run as often as you want.
 */
export async function runRefreshQueue(): Promise<void> {
  const start = Date.now();

  const items = await db()
    .select()
    .from(discoveryQueue)
    .where(eq(discoveryQueue.processed, false))
    .orderBy(asc(discoveryQueue.queuedAt))
    .limit(BATCH_SIZE);

  if (items.length === 0) {
    log.debug('refresh-queue.empty');
    return;
  }

  log.info({ batch: items.length }, 'refresh-queue.start');

  let totalFills = 0;
  let totalAgents = 0;
  let totalWeight = 0;
  let errors = 0;

  for (const item of items) {
    try {
      const result = await ingestWallet(item.address);
      totalFills += result.fillsInserted;
      totalAgents += result.agentCount;
      totalWeight += result.weightCost;
    } catch (err: unknown) {
      errors += 1;
      log.error(
        { address: item.address, err: serializeError(err) },
        'refresh-queue.ingest_failed',
      );
      // Mark processed so we don't loop forever on a poison entry.
      // The wallet stays in the wallets table; a manual `refresh-leader` can retry.
      await db()
        .update(discoveryQueue)
        .set({ processed: true, processedAt: new Date() })
        .where(and(eq(discoveryQueue.address, item.address), eq(discoveryQueue.processed, false)));
    }
  }

  log.info(
    { processed: items.length, errors, totalFills, totalAgents, totalWeight, ms: Date.now() - start },
    'refresh-queue.done',
  );
}

function serializeError(err: unknown): { message: string; name?: string } {
  if (err instanceof Error) return { message: err.message, name: err.name };
  return { message: String(err) };
}
