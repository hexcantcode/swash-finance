import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';

async function main() {
  const r = await db().execute(sql`
    select coin, count(*) as fills,
           min(block_time_ms) as first_ms,
           max(block_time_ms) as latest_ms,
           count(distinct user_address) as wallets
    from fills
    where coin like '@%'
    group by coin
    order by latest_ms desc
    limit 20
  `);
  console.log('@-prefixed coins seen in fills:');
  for (const row of r.rows) console.log(' ', row);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
