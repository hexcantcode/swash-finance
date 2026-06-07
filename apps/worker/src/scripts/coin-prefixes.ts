import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // Look for ALL non-letter-prefix coins in fills
  const r = await db().execute(sql`
    select substring(coin from 1 for 1) as prefix, count(*) as n, count(distinct coin) as unique_coins
    from fills
    where coin !~ '^[A-Za-z]'
    group by substring(coin from 1 for 1)
    order by n desc
  `);
  console.log('non-alpha coin prefixes:');
  for (const row of r.rows) console.log(' ', row);

  const r2 = await db().execute(sql`
    select coin, count(*) as n
    from fills
    where coin like '#%'
    group by coin
    order by n desc
    limit 10
  `);
  console.log('# coins:', r2.rows.length);
  for (const row of r2.rows) console.log(' ', row);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
