import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';

async function main() {
  const r = await db().execute(sql`
    select s.address, s.win_rate, s.total_round_trips, s.total_trades, s.computed_at
    from scores s
    join wallets w on w.address = s.address
    where w.is_agent = false
      and w.account_value >= 25000
      and s.win_rate is not null
      and s.total_round_trips >= 10
      and s.computed_at >= (select max(computed_at) - interval '24 hours' from scores)
    order by s.win_rate desc
    limit 10
  `);
  console.log('Top-10 by Win Rate (after fix):');
  console.log('-'.repeat(80));
  for (const row of r.rows as any[]) {
    const wr = Number.parseFloat(row.win_rate);
    console.log(
      `${row.address.slice(0, 14)}..  WR=${(wr * 100).toFixed(1).padStart(5)}%  ` +
        `RTs=${String(row.total_round_trips).padStart(4)}  ` +
        `fills=${String(row.total_trades).padStart(6)}  ` +
        `at=${row.computed_at}`,
    );
  }
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
