import { db, closeDb } from '../db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // For each top-Win-Rate candidate, recompute win rate the current way (per-
  // fill: closedPnl-fee > 0) vs closing-fills-only (closedPnl != 0). Show the
  // gap.
  const rows = await db().execute<{
    address: string;
    current_wr: string;
    total_round_trips: number;
    n_fills: string;
    closing_fills: string;
    n_wins_perfill: string;
    n_wins_closing: string;
    sum_pnl: string;
  }>(sql`
    with leaders as (
      select s.address, s.win_rate, s.total_round_trips
      from scores s
      join wallets w on w.address = s.address
      where w.is_agent = false
        and w.account_value >= 25000
        and s.win_rate is not null
        and s.total_round_trips >= 10
        and s.computed_at >= (select max(computed_at) - interval '24 hours' from scores)
      order by s.win_rate desc
      limit 20
    )
    select
      l.address,
      l.win_rate::text as current_wr,
      l.total_round_trips,
      count(*)::text                                                   as n_fills,
      count(*) filter (where f.closed_pnl::numeric <> 0)::text         as closing_fills,
      count(*) filter (where (f.closed_pnl::numeric - f.fee::numeric) > 0)::text as n_wins_perfill,
      count(*) filter (
        where f.closed_pnl::numeric <> 0
          and (f.closed_pnl::numeric - f.fee::numeric) > 0
      )::text                                                          as n_wins_closing,
      sum(f.closed_pnl::numeric - f.fee::numeric)::text                as sum_pnl
    from leaders l
    join fills f on f.user_address = l.address
    group by l.address, l.win_rate, l.total_round_trips
    order by l.win_rate desc
  `);
  console.log('Top-20 Win Rate candidates: current per-fill vs closing-only WR');
  console.log('-'.repeat(120));
  console.log('addr            | RTs  | n_fills | n_closing | per-fill WR | closing-only WR | gap   | net PnL');
  console.log('-'.repeat(120));
  for (const r of rows.rows) {
    const n = parseInt(r.n_fills);
    const closing = parseInt(r.closing_fills);
    const winsAll = parseInt(r.n_wins_perfill);
    const winsClosing = parseInt(r.n_wins_closing);
    const wrCur = winsAll / n;
    const wrClose = closing > 0 ? winsClosing / closing : 0;
    const gap = wrClose - wrCur;
    console.log(
      `${r.address.slice(0, 14)}.. | ${String(r.total_round_trips).padStart(4)} | ` +
        `${String(n).padStart(7)} | ${String(closing).padStart(9)} | ` +
        `${(wrCur * 100).toFixed(1).padStart(10)}% | ` +
        `${(wrClose * 100).toFixed(1).padStart(13)}% | ` +
        `${(gap * 100 >= 0 ? '+' : '') + (gap * 100).toFixed(1).padStart(4)}% | $${parseFloat(r.sum_pnl).toFixed(0)}`,
    );
  }
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
