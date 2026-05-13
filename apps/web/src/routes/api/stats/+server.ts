import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { scores, wallets } from '@copytrade/db';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const rows = await db()
    .select({
      total_wallets: sql<number>`(select count(*) from ${wallets})::int`,
      total_leaders_scored: sql<number>`(select count(*) from ${scores})::int`,
      avg_score: sql<number>`(select round(avg(${wallets.score}))::int from ${wallets} where ${wallets.score} is not null)`,
      last_score_run: sql<string>`(select max(${scores.computedAt}) from ${scores})`,
    })
    .from(wallets)
    .limit(1);
  return json({ ok: true, data: rows[0] });
};
