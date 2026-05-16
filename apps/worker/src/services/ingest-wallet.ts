import { and, eq, sql } from 'drizzle-orm';
import {
  discoveryQueue,
  fills,
  fundings,
  ledgerUpdates,
  wallets,
  type NewFill,
  type NewFunding,
  type NewLedgerUpdate,
} from '@copytrade/db';
import { normalizeAddress } from '@copytrade/shared';
import { db } from '../db.js';
import { hl } from '../hl.js';
import { log } from '../log.js';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export interface IngestResult {
  address: string;
  fillsInserted: number;
  fundingsInserted: number;
  ledgerInserted: number;
  agentCount: number;
  weightCost: number;
}

/**
 * Ingest the trading history for a single wallet, plus the histories of all
 * its currently-approved agent wallets (rolled up so the master's score
 * reflects all activity).
 *
 * [CRITICAL — spec § 9 agent attribution]
 *   Many leaders trade through agents to avoid signing every order. For
 *   correct scoring we MUST query each agent's fills as well and store them
 *   alongside the master, with `wallets.master_address` set to the master.
 */
export async function ingestWallet(rawAddress: string): Promise<IngestResult> {
  const address = normalizeAddress(rawAddress);
  const start = Date.now();
  let weightCost = 0;

  // Step 1: discover agent wallets for this master.
  const agentsResp = await hl().extraAgents(address);
  weightCost += agentsResp.weightCost;
  const agentAddresses = agentsResp.data.map((a) => normalizeAddress(a.address));

  // Step 2: ingest history for the master itself.
  const masterCounts = await ingestSingleAddress(address);
  weightCost += masterCounts.weightCost;

  // Step 3: ingest history for every approved agent. Mark them as agents
  // and link to the master.
  let agentFillsInserted = 0;
  let agentFundingsInserted = 0;
  let agentLedgerInserted = 0;

  if (agentAddresses.length > 0) {
    const now = new Date();
    await db()
      .insert(wallets)
      .values(
        agentsResp.data.map((a) => ({
          address: normalizeAddress(a.address),
          masterAddress: address,
          isAgent: true,
          agentName: a.name,
          agentValidUntil: a.validUntil,
          firstSeenAt: now,
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: wallets.address,
        set: {
          masterAddress: sql`excluded.master_address`,
          isAgent: sql`true`,
          agentName: sql`excluded.agent_name`,
          agentValidUntil: sql`excluded.agent_valid_until`,
          updatedAt: now,
        },
      });

    for (const agent of agentAddresses) {
      const c = await ingestSingleAddress(agent);
      agentFillsInserted += c.fillsInserted;
      agentFundingsInserted += c.fundingsInserted;
      agentLedgerInserted += c.ledgerInserted;
      weightCost += c.weightCost;
    }
  }

  // Step 4: refresh wallet aggregates (master only).
  await refreshWalletAggregates(address);

  // Step 5: promote ingest_state if still below 'ingested'. Never downgrade
  // a 'scored' wallet — re-ingest of fills doesn't unscore them.
  await db().execute(sql`
    update wallets set ingest_state = 'ingested'
    where address = ${address}
      and ingest_state in ('observed', 'queued')
  `);

  // Step 6: mark queue item processed if present.
  await db()
    .update(discoveryQueue)
    .set({ processed: true, processedAt: new Date() })
    .where(and(eq(discoveryQueue.address, address), eq(discoveryQueue.processed, false)));

  log.info(
    {
      address,
      agents: agentAddresses.length,
      fills: masterCounts.fillsInserted + agentFillsInserted,
      fundings: masterCounts.fundingsInserted + agentFundingsInserted,
      ledger: masterCounts.ledgerInserted + agentLedgerInserted,
      weight: weightCost,
      ms: Date.now() - start,
    },
    'ingest.done',
  );

  return {
    address,
    fillsInserted: masterCounts.fillsInserted + agentFillsInserted,
    fundingsInserted: masterCounts.fundingsInserted + agentFundingsInserted,
    ledgerInserted: masterCounts.ledgerInserted + agentLedgerInserted,
    agentCount: agentAddresses.length,
    weightCost,
  };
}

interface SingleAddressResult {
  fillsInserted: number;
  fundingsInserted: number;
  ledgerInserted: number;
  weightCost: number;
}

/**
 * HL caps each `userFillsByTime` response at ~2000 rows. For high-frequency
 * traders (Loracle / Fasanara: hundreds of fills per day), one call covers
 * only a few days of the 90-day window. Walk the window forward in time,
 * advancing `startTime` past the last row of each page, until we get back
 * an empty page or hit `MAX_PAGES` (safety stop — 50 × 2000 = 100k fills).
 */
const FILLS_PAGE_LIMIT = 50;

async function pageUserFillsByTime<T extends { time: number }>(
  fetcher: (startMs: number) => Promise<{ data: T[]; weightCost: number }>,
  startMs: number,
  endMs: number,
): Promise<{ data: T[]; weightCost: number; pages: number }> {
  let cursor = startMs;
  let weightCost = 0;
  let pages = 0;
  const all: T[] = [];
  const seen = new Set<number>();
  while (pages < FILLS_PAGE_LIMIT) {
    const resp = await fetcher(cursor);
    weightCost += resp.weightCost;
    pages += 1;
    if (resp.data.length === 0) break;
    let advanced = false;
    let maxTime = cursor;
    for (const row of resp.data) {
      // The same `time` value can appear on adjacent pages — dedupe by the
      // fill's natural key when we know it (`tid` for fills); here we just
      // keep both and let the DB ON CONFLICT DO NOTHING handle it.
      all.push(row);
      if (row.time > maxTime) {
        maxTime = row.time;
        advanced = true;
      }
      seen.add(row.time);
    }
    // If the page filled to the cap and we haven't reached `endMs`, walk
    // forward by 1ms past the latest fill. If `time` didn't advance (every
    // row was on the same ms — very unlikely), bail to avoid infinite loop.
    if (!advanced || resp.data.length < 100) break;
    cursor = maxTime + 1;
    if (cursor >= endMs) break;
  }
  return { data: all, weightCost, pages };
}

async function ingestSingleAddress(address: string): Promise<SingleAddressResult> {
  const since = Date.now() - NINETY_DAYS_MS;
  const nowMs = Date.now();
  const [fillsPaged, fundingsPaged, ledgerPaged] = await Promise.all([
    pageUserFillsByTime(
      async (start) => {
        const r = await hl().userFillsByTime(address, start);
        return { data: r.data, weightCost: r.weightCost };
      },
      since,
      nowMs,
    ),
    pageUserFillsByTime(
      async (start) => {
        const r = await hl().userFunding(address, start);
        return { data: r.data, weightCost: r.weightCost };
      },
      since,
      nowMs,
    ),
    pageUserFillsByTime(
      async (start) => {
        const r = await hl().userNonFundingLedgerUpdates(address, start);
        return { data: r.data, weightCost: r.weightCost };
      },
      since,
      nowMs,
    ),
  ]);
  const fillsResp = { data: fillsPaged.data, weightCost: fillsPaged.weightCost };
  const fundingsResp = { data: fundingsPaged.data, weightCost: fundingsPaged.weightCost };
  const ledgerResp = { data: ledgerPaged.data, weightCost: ledgerPaged.weightCost };

  const weightCost = fillsResp.weightCost + fundingsResp.weightCost + ledgerResp.weightCost;
  const now = new Date();

  let fillsInserted = 0;
  let fundingsInserted = 0;
  let ledgerInserted = 0;

  if (fillsResp.data.length > 0) {
    const rows: NewFill[] = fillsResp.data.map((f) => ({
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
    // onConflictDoUpdate so REST enrichment overwrites any sentinel rows left
    // by `trades-coin-subscriber` (fee=0, closedPnl=0). Stable fields (coin,
    // side, px, sz, hash, block_time_ms) should already match; we only update
    // the columns the firehose can't observe.
    fillsInserted = await chunkedInsertReturning(
      (chunk) =>
        db()
          .insert(fills)
          .values(chunk)
          .onConflictDoUpdate({
            target: [fills.tid, fills.userAddress],
            set: {
              fee: sql`excluded.fee`,
              feeToken: sql`excluded.fee_token`,
              builderFee: sql`excluded.builder_fee`,
              oid: sql`excluded.oid`,
              crossed: sql`excluded.crossed`,
              closedPnl: sql`excluded.closed_pnl`,
              startPosition: sql`excluded.start_position`,
              liquidationUser: sql`excluded.liquidation_user`,
            },
          })
          .returning({ tid: fills.tid }),
      rows,
    );
  }

  if (fundingsResp.data.length > 0) {
    const rows: NewFunding[] = fundingsResp.data.map((f) => ({
      userAddress: address,
      blockTimeMs: f.time,
      coin: f.delta.coin,
      usdc: f.delta.usdc,
      szi: f.delta.szi,
      fundingRate: f.delta.fundingRate,
      createdAt: now,
    }));
    fundingsInserted = await chunkedInsertReturning(
      (chunk) =>
        db()
          .insert(fundings)
          .values(chunk)
          .onConflictDoNothing()
          .returning({ id: fundings.id }),
      rows,
    );
  }

  if (ledgerResp.data.length > 0) {
    const rows: NewLedgerUpdate[] = ledgerResp.data.map((l) => {
      const details = l.delta as unknown as Record<string, unknown>;
      const usdc =
        typeof details['usdc'] === 'string' ? (details['usdc'] as string) : null;
      const type =
        typeof details['type'] === 'string' ? (details['type'] as string) : 'unknown';
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
    ledgerInserted = await chunkedInsertReturning(
      (chunk) =>
        db()
          .insert(ledgerUpdates)
          .values(chunk)
          .onConflictDoNothing()
          .returning({ id: ledgerUpdates.id }),
      rows,
    );
  }

  return { fillsInserted, fundingsInserted, ledgerInserted, weightCost };
}

async function chunkedInsertReturning<TRow, TReturn>(
  insert: (chunk: TRow[]) => Promise<TReturn[]>,
  rows: TRow[],
  chunkSize = 200,
): Promise<number> {
  let count = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const inserted = await insert(rows.slice(i, i + chunkSize));
    count += inserted.length;
  }
  return count;
}

async function refreshWalletAggregates(address: string): Promise<void> {
  await db().execute(sql`
    update wallets
    set
      total_fills = coalesce((select count(*) from fills where user_address = ${address}), 0),
      total_volume_usd = coalesce(
        (select sum(px * sz) from fills where user_address = ${address}),
        0
      ),
      last_seen_at = coalesce(
        (select to_timestamp(max(block_time_ms) / 1000.0) from fills where user_address = ${address}),
        last_seen_at
      ),
      updated_at = now()
    where address = ${address}
  `);
}
