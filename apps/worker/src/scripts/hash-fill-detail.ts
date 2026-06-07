import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // What addresses had #N fills, and what other coins did they trade?
  const r = await db().execute(sql`
    select user_address, coin, side, sz, px, fee, fee_token, block_time_ms
    from fills
    where coin like '#%'
    order by block_time_ms desc
    limit 10
  `);
  console.log('#-prefixed fills (latest 10):');
  for (const row of r.rows) console.log(' ', row);

  // Sample wallets with most #N fills
  const r2 = await db().execute(sql`
    select user_address, count(*) as n_hash, count(distinct coin) as unique_hash_coins
    from fills
    where coin like '#%'
    group by user_address
    order by n_hash desc
    limit 5
  `);
  console.log('top #N traders:');
  for (const row of r2.rows) console.log(' ', row);

  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
