import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // 1) HIP-3 fills in last 7 days
  const fillsHip3 = await db().execute(sql`
    select count(*) as n, count(distinct user_address) as wallets
    from fills
    where coin like '%:%' and block_time_ms >= (extract(epoch from now() - interval '7 days')::bigint * 1000)
  `);
  console.log('hip-3 fills last 7d:', fillsHip3.rows[0]);

  // 2) Which wallets have current open HIP-3 positions per fills (entry-not-exited)?
  // Simpler: which wallets have a HIP-3 fill in last 24h?
  const recentHip3 = await db().execute(sql`
    select user_address as address, count(*) as fills, sum(case when side = 'B' then 1 else 0 end) as buys, sum(case when side = 'A' then 1 else 0 end) as sells
    from fills
    where coin like '%:%' and block_time_ms >= (extract(epoch from now() - interval '24 hours')::bigint * 1000)
    group by user_address
    order by fills desc
    limit 20
  `);
  console.log('wallets w/ HIP-3 fills in last 24h:', recentHip3.rows.length);
  for (const r of recentHip3.rows.slice(0, 10)) console.log('  ', r);

  // 3) For top-250 tracked set, do any have leader_cache with last_refreshed_at recent?
  const trackedRefresh = await db().execute(sql`
    with tracked as (
      select address from wallets
      where is_agent = false and account_value >= 25000 and hl_pnl_7d_usd is not null
      order by hl_pnl_7d_usd desc
      limit 250
    )
    select
      count(*) as tracked_total,
      sum(case when lc.last_refreshed_at >= now() - interval '15 minutes' then 1 else 0 end) as refreshed_15m,
      sum(case when lc.last_refreshed_at >= now() - interval '1 hour' then 1 else 0 end) as refreshed_1h,
      sum(case when lc.last_refreshed_at >= now() - interval '6 hours' then 1 else 0 end) as refreshed_6h,
      sum(case when lc.last_refreshed_at >= now() - interval '24 hours' then 1 else 0 end) as refreshed_24h,
      sum(case when lc.address is null then 1 else 0 end) as no_cache
    from tracked t
    left join leader_cache lc on lc.address = t.address
  `);
  console.log('tracked-set leader_cache freshness:', trackedRefresh.rows[0]);

  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
