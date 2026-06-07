import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';
import { computeBehavioral, type BehavioralFill } from '@copytrade/scoring';

async function main() {
  const address = process.argv[2];
  if (!address) {
    console.error('usage: tsx spot-check-winrate.ts 0x...');
    process.exit(1);
  }

  const rows = await db().execute<{
    block_time_ms: string;
    coin: string;
    side: 'B' | 'A';
    px: string;
    sz: string;
    start_position: string | null;
    crossed: boolean;
    closed_pnl: string;
    fee: string;
  }>(sql`
    select block_time_ms, coin, side, px, sz, start_position, crossed, closed_pnl, fee
    from fills
    where user_address = ${address}
    order by block_time_ms asc, tid asc
  `);

  const fills: BehavioralFill[] = rows.rows.map((r) => ({
    blockTimeMs: Number(r.block_time_ms),
    coin: r.coin,
    side: r.side,
    px: r.px,
    sz: r.sz,
    startPosition: r.start_position,
    crossed: r.crossed,
    closedPnl: r.closed_pnl,
    fee: r.fee,
  }));

  const beh = computeBehavioral(fills, { activeDays: 1 });
  const pnls = beh.roundTripPnls;
  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.length - wins;
  const wr = pnls.length === 0 ? null : wins / pnls.length;
  const netCycle = pnls.reduce((a, b) => a + b, 0);

  const stored = await db().execute<{
    win_rate: string | null;
    total_round_trips: number;
    net_pnl_usd: string;
  }>(sql`select win_rate, total_round_trips, net_pnl_usd from scores where address = ${address}`);

  console.log(`address:        ${address}`);
  console.log(`fills:          ${fills.length}`);
  console.log(`coins:          ${new Set(fills.map((f) => f.coin)).size}`);
  console.log('---- recomputed via computeBehavioral ----');
  console.log(`round trips:    ${pnls.length}`);
  console.log(`wins:           ${wins}`);
  console.log(`losses:         ${losses}`);
  console.log(`win_rate:       ${wr === null ? 'null' : wr.toFixed(6)}`);
  console.log(`Σ cycle PnL:    ${netCycle.toFixed(2)}`);
  console.log('---- stored in scores ----');
  console.log(`win_rate:       ${stored.rows[0]?.win_rate ?? 'null'}`);
  console.log(`round trips:    ${stored.rows[0]?.total_round_trips ?? 'null'}`);
  console.log(`net_pnl_usd:    ${stored.rows[0]?.net_pnl_usd ?? 'null'}`);

  if (pnls.length > 0) {
    const sorted = [...pnls].sort((a, b) => a - b);
    console.log('---- distribution ----');
    console.log(`min cycle:     ${sorted[0]!.toFixed(2)}`);
    console.log(`max cycle:     ${sorted[sorted.length - 1]!.toFixed(2)}`);
    console.log(`median:        ${sorted[Math.floor(sorted.length / 2)]!.toFixed(2)}`);
    console.log(`worst 5:       ${sorted.slice(0, 5).map((p) => p.toFixed(0)).join(', ')}`);
    console.log(`best 5:        ${sorted.slice(-5).map((p) => p.toFixed(0)).join(', ')}`);
  }

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
