import { and, eq, inArray, sql } from 'drizzle-orm';
import { discoveryQueue, wallets } from '@copytrade/db';
import { db } from '../db.js';
import { fetchHyperdashGroup, isCopyEnabled, type HyperdashTrader } from '../lib/hyperdash.js';
import { log } from '../log.js';

/**
 * Ingest Hyperdash's curated copytraders as a discovery source.
 *
 * Hyperdash is a *seed* only — we persist the addresses and queue them for the
 * normal fills→score pipeline, which then owns every number the app displays.
 * Hyperdash's own pnl/copyScore are NOT written to display columns (different
 * windows / foreign definitions); they're used only to pick who to track.
 *
 * Wallets land with `source='hyperdash'`, which floats them to the top of the
 * trader list in leaders.ts ("primary roster"). The scoring quality gate is
 * unchanged — a Hyperdash wallet only appears once it passes `tracked_wallets`.
 *
 * Idempotent. Run hourly (cron) to refresh the curated set.
 */

export interface HyperdashIngestOptions {
  /** Which Hyperdash system group to pull (default the top-100 copytraders). */
  groupId?: string;
  /** Persist/queue every returned wallet, not just copy-enabled ones. */
  includeNonCopyEnabled?: boolean;
}

export async function runHyperdashIngest(opts: HyperdashIngestOptions = {}): Promise<void> {
  const groupId = opts.groupId ?? 'copytraders';
  const startedAt = Date.now();
  log.info({ groupId }, 'hyperdash.start');

  const all = await fetchHyperdashGroup(groupId);
  const rows = opts.includeNonCopyEnabled ? all : all.filter(isCopyEnabled);
  log.info(
    { fetched: all.length, copyEnabled: all.filter(isCopyEnabled).length, toIngest: rows.length },
    'hyperdash.fetched',
  );

  if (rows.length === 0) {
    log.warn('hyperdash.no_candidates');
    return;
  }

  const { walletsUpserted, queuedNew } = await persistAndQueueHyperdashRows(rows);

  log.info(
    { walletsUpserted, queuedNew, ms: Date.now() - startedAt },
    'hyperdash.done',
  );
}

/**
 * Upsert Hyperdash rows into `wallets` (marking `source='hyperdash'`) and push
 * them into `discovery_queue` for deep ingest. Mirrors
 * `persistAndQueueLeaderboardRows` but stamps the source and seeds only the
 * fields we trust from Hyperdash (equity, name) — never the HL snapshot
 * columns, which scoring fills from real fills.
 */
async function persistAndQueueHyperdashRows(
  rows: HyperdashTrader[],
): Promise<{ walletsUpserted: number; queuedNew: number }> {
  const now = new Date();
  const CHUNK = 500;
  let walletsUpserted = 0;
  let queuedNew = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    await db()
      .insert(wallets)
      .values(
        chunk.map((r) => ({
          address: r.address.toLowerCase(),
          firstSeenAt: now,
          lastSeenAt: now,
          accountValue: equityOrNull(r.perpsEquity),
          displayName: r.label ?? r.displayName,
          source: 'hyperdash',
        })),
      )
      .onConflictDoUpdate({
        target: wallets.address,
        set: {
          // Don't regress discovery timestamps; refresh equity/name.
          lastSeenAt: sql`greatest(${wallets.lastSeenAt}, excluded.last_seen_at)`,
          accountValue: sql`coalesce(excluded.account_value, ${wallets.accountValue})`,
          displayName: sql`coalesce(excluded.display_name, ${wallets.displayName})`,
          // Sticky promote to 'hyperdash' even if the wallet was HL-sourced.
          source: sql`excluded.source`,
          updatedAt: now,
        },
      });
    walletsUpserted += chunk.length;
  }

  // Queue for deep ingest; only flip 'observed' → 'queued' (never downgrade).
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const queueResult = await db()
      .insert(discoveryQueue)
      .values(chunk.map((r) => ({ address: r.address.toLowerCase(), source: 'hyperdash' })))
      .onConflictDoNothing({ target: discoveryQueue.address })
      .returning({ address: discoveryQueue.address });
    queuedNew += queueResult.length;

    if (queueResult.length > 0) {
      const addresses = queueResult.map((q) => q.address);
      await db()
        .update(wallets)
        .set({ ingestState: 'queued' })
        .where(and(inArray(wallets.address, addresses), eq(wallets.ingestState, 'observed')));
    }
  }

  return { walletsUpserted, queuedNew };
}

/** Hyperdash equity string → numeric(30,8) string, or null when absent/zero. */
function equityOrNull(perpsEquity: string | null): string | null {
  const n = Number.parseFloat(perpsEquity ?? '');
  return Number.isFinite(n) && n > 0 ? n.toFixed(8) : null;
}
