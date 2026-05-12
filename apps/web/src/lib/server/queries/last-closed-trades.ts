import { desc, inArray, sql } from 'drizzle-orm';
import { fills, wallets } from '@copytrade/db';
import { db } from '../db.js';

export type TradeResult = 'win' | 'loss';

/**
 * The last `n` *closed positions* (round-trips) per master wallet, newest first,
 * as win/loss.
 *
 * A round-trip = a position opened and brought back to ≈flat (or flipped); its
 * result is the sign of the realized PnL accumulated over its fills
 * (`fills.closedPnl`). Positions are reconstructed per (userAddress, coin) from
 * the fill stream — deliberately NOT "last `n` fills" (a single close can span
 * several fills). Master + agents are both included.
 *
 * Only the most recent ~`fillWindow` fills per wallet group are pulled — enough
 * to cover the last `n` round-trips for an active trader; a position whose
 * *open* fell outside the window yields a slightly-partial PnL (acceptable v1).
 */
export async function getLastClosedTrades(
  masterAddresses: string[],
  n = 10,
  fillWindow = 150,
): Promise<Map<string, TradeResult[]>> {
  const out = new Map<string, TradeResult[]>();
  if (masterAddresses.length === 0) return out;

  for (const master of masterAddresses) {
    const linkedRows = await db()
      .select({ address: wallets.address })
      .from(wallets)
      .where(sql`${wallets.address} = ${master} or ${wallets.masterAddress} = ${master}`);
    const linked = linkedRows.map((r) => r.address);
    if (linked.length === 0) {
      out.set(master, []);
      continue;
    }

    const fillRows = await db()
      .select({
        userAddress: fills.userAddress,
        coin: fills.coin,
        side: fills.side,
        sz: fills.sz,
        startPosition: fills.startPosition,
        closedPnl: fills.closedPnl,
        blockTimeMs: fills.blockTimeMs,
        tid: fills.tid,
      })
      .from(fills)
      .where(inArray(fills.userAddress, linked))
      .orderBy(desc(fills.blockTimeMs), desc(fills.tid))
      .limit(fillWindow);

    // Replay oldest → newest, per (userAddress, coin).
    const ordered = fillRows.slice().reverse();
    const trips: Array<{ time: number; pnl: number }> = [];
    const posByKey = new Map<string, number>();
    const pnlByKey = new Map<string, number>();

    for (const f of ordered) {
      const sz = Number.parseFloat(f.sz);
      if (!Number.isFinite(sz)) continue;
      const key = `${f.userAddress}:${f.coin}`;

      let prev = posByKey.get(key);
      if (prev === undefined) {
        const sp = Number.parseFloat(f.startPosition ?? '');
        prev = Number.isFinite(sp) ? sp : 0;
      }
      const pos = prev + (f.side === 'B' ? sz : -sz);
      posByKey.set(key, pos);

      const closedPnl = Number.parseFloat(f.closedPnl ?? '0');
      const tripPnl = (pnlByKey.get(key) ?? 0) + (Number.isFinite(closedPnl) ? closedPnl : 0);

      const closedToFlat = Math.abs(pos) < 1e-9;
      const flipped = prev !== 0 && pos !== 0 && Math.sign(prev) !== Math.sign(pos);
      if (closedToFlat || flipped) {
        trips.push({ time: f.blockTimeMs, pnl: tripPnl });
        pnlByKey.set(key, 0);
      } else {
        pnlByKey.set(key, tripPnl);
      }
    }

    trips.sort((a, b) => b.time - a.time);
    out.set(
      master,
      trips.slice(0, n).map((t) => (t.pnl > 0 ? 'win' : 'loss')),
    );
  }

  return out;
}
