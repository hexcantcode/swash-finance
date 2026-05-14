import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // Are the 5 recent HIP-3 traders in our top-250 tracked-set?
  const r = await db().execute(sql`
    with tracked as (
      select address, hl_pnl_7d_usd
      from wallets
      where is_agent = false and account_value >= 25000 and hl_pnl_7d_usd is not null
      order by hl_pnl_7d_usd desc
      limit 250
    ),
    hip3 as (
      select user_address as address, count(*) as fills_24h
      from fills
      where coin like '%:%' and block_time_ms >= (extract(epoch from now() - interval '24 hours')::bigint * 1000)
      group by user_address
    )
    select h.address, h.fills_24h, t.hl_pnl_7d_usd, (t.address is not null) as in_top_250
    from hip3 h
    left join tracked t on t.address = h.address
    order by h.fills_24h desc
  `);
  console.log('5 HIP-3-active wallets vs top-250:');
  for (const row of r.rows) console.log('  ', row);

  // Top-250 wallets that have any HIP-3 fill EVER (broader lookup)
  const hip3Ever = await db().execute(sql`
    with tracked as (
      select address
      from wallets
      where is_agent = false and account_value >= 25000 and hl_pnl_7d_usd is not null
      order by hl_pnl_7d_usd desc
      limit 250
    )
    select count(distinct f.user_address) as tracked_hip3_traders
    from fills f join tracked t on t.address = f.user_address
    where f.coin like '%:%'
  `);
  console.log('top-250 with any HIP-3 fill:', hip3Ever.rows[0]);

  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
