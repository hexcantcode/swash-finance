import { desc, eq, sql } from 'drizzle-orm';
import { fills, wallets } from '@copytrade/db';
import { db } from '../db.js';

export interface TickerTrade {
  tid: number;
  block_time_ms: number;
  address: string;
  master_address: string;
  coin: string;
  side: 'B' | 'A';
  px: number;
  sz: number;
  notional: number;
  primary_tag: string | null;
}

/**
 * Fetch the most recent fills across our entire ingested universe, rolled up
 * to the master wallet for each so the ticker doesn't flood with agent
 * addresses. Sorted by block_time_ms desc.
 */
export async function listRecentTrades(limit = 40): Promise<TickerTrade[]> {
  const rows = await db()
    .select({
      tid: fills.tid,
      block_time_ms: fills.blockTimeMs,
      address: fills.userAddress,
      master_address: sql<string>`coalesce(${wallets.masterAddress}, ${fills.userAddress})`,
      coin: fills.coin,
      side: fills.side,
      px: fills.px,
      sz: fills.sz,
      primary_tag: sql<string | null>`(
        select w2.primary_tag from wallets w2
        where w2.address = coalesce(${wallets.masterAddress}, ${fills.userAddress})
      )`,
    })
    .from(fills)
    .leftJoin(wallets, eq(wallets.address, fills.userAddress))
    .orderBy(desc(fills.blockTimeMs))
    .limit(limit);

  return rows.map((r) => {
    const px = Number.parseFloat(r.px);
    const sz = Number.parseFloat(r.sz);
    return {
      tid: r.tid,
      block_time_ms: r.block_time_ms,
      address: r.address,
      master_address: r.master_address,
      coin: r.coin,
      side: r.side as 'B' | 'A',
      px,
      sz,
      notional: px * sz,
      primary_tag: r.primary_tag,
    };
  });
}
