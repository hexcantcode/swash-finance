import { db, closeDb } from '../apps/worker/src/db.js';
import { sql } from 'drizzle-orm';

async function main() {
  const counts = await db().execute(sql`
    select
      (select count(*) from wallets where is_agent = false and account_value >= 25000 and hl_pnl_7d_usd is not null) as tracked_size,
      (select count(distinct lc.address) from leader_cache lc where jsonb_array_length(coalesce(lc.positions_json, '[]'::jsonb)) > 0) as wallets_with_positions,
      (select count(*) from leader_cache lc where lc.last_refreshed_at >= now() - interval '5 minutes') as refreshed_in_last_5min
  `);
  console.log('counts', counts.rows[0]);

  const hip3 = await db().execute(sql`
    select lc.address, p->>'coin' as coin, p->>'szi' as szi, p->>'unrealizedPnl' as upnl
    from leader_cache lc, jsonb_array_elements(lc.positions_json) p
    where p->>'coin' like '%:%'
    limit 50
  `);
  console.log('hip3 positions in leader_cache:', hip3.rows.length);
  for (const r of hip3.rows.slice(0, 10)) console.log('  ', r);

  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
