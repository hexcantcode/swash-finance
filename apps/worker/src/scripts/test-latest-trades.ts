import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // Mirror getLatestTrades scope='tracked'
  try {
    const limit = 20;
    const rows = await db().execute(sql`
      SELECT
        COALESCE(w.master_address, f.user_address)  AS address,
        f.coin,
        f.side,
        COALESCE(f.oid::text, 'tid:' || f.tid::text) AS group_key,
        SUM(f.sz::numeric)                          AS total_sz,
        SUM(f.sz::numeric * f.px::numeric)          AS total_notional,
        MAX(f.block_time_ms)                        AS latest_ms,
        COUNT(*)                                    AS fill_count
      FROM fills f
      LEFT JOIN wallets w ON w.address = f.user_address
      WHERE COALESCE(w.master_address, f.user_address) IN (SELECT address FROM leader_cache)
      GROUP BY COALESCE(w.master_address, f.user_address), f.coin, f.side,
               COALESCE(f.oid::text, 'tid:' || f.tid::text)
      ORDER BY MAX(f.block_time_ms) DESC
      LIMIT ${limit}
    `);
    console.log('tracked rows:', rows.rows.length);
    console.log('first:', rows.rows[0]);
  } catch (e: any) {
    console.error('tracked FAILED:', e?.message ?? e);
  }

  // Mirror scope='all'
  try {
    const limit = 40;
    const rows = await db().execute(sql`
      SELECT
        COALESCE(w.master_address, f.user_address)  AS address,
        f.coin,
        f.side,
        COALESCE(f.oid::text, 'tid:' || f.tid::text) AS group_key,
        SUM(f.sz::numeric)                          AS total_sz,
        SUM(f.sz::numeric * f.px::numeric)          AS total_notional,
        MAX(f.block_time_ms)                        AS latest_ms,
        COUNT(*)                                    AS fill_count
      FROM fills f
      LEFT JOIN wallets w ON w.address = f.user_address
      GROUP BY COALESCE(w.master_address, f.user_address), f.coin, f.side,
               COALESCE(f.oid::text, 'tid:' || f.tid::text)
      ORDER BY MAX(f.block_time_ms) DESC
      LIMIT ${limit}
    `);
    console.log('all rows:', rows.rows.length);
    console.log('first:', rows.rows[0]);
  } catch (e: any) {
    console.error('all FAILED:', e?.message ?? e);
  }

  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
