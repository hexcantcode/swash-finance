import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // Check for any asset/coin/symbol with unusual characters in our DBs.
  const fills = await db().execute(sql`
    select distinct coin
    from fills
    where coin ~ '[^\\x20-\\x7e]'
    limit 20
  `);
  console.log('fills with non-ASCII coin:', fills.rows.length);
  for (const r of fills.rows) console.log('  ', JSON.stringify(r));

  // From leader_cache positions_json
  const lcCoins = await db().execute(sql`
    select distinct p.elem -> 'position' ->> 'coin' as coin
    from leader_cache lc, jsonb_array_elements(coalesce(lc.positions_json, '[]'::jsonb)) p(elem)
    where (p.elem -> 'position' ->> 'coin') ~ '[^\\x20-\\x7e]'
    limit 20
  `);
  console.log('leader_cache coins with non-ASCII:', lcCoins.rows.length);
  for (const r of lcCoins.rows) console.log('  ', JSON.stringify(r));

  // Any coins starting with a non-Latin char (some HL HIP-3 tokens look odd)
  const oddStart = await db().execute(sql`
    select distinct coin, count(*) as n
    from fills
    where length(coin) < 25
    group by coin
    order by coin desc
    limit 30
  `);
  console.log('top 30 coins by name (desc):');
  for (const r of oddStart.rows) console.log(' ', r.coin, '(', r.n, ')');

  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
