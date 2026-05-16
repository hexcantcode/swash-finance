import { error, json } from '@sveltejs/kit';
import { sql, eq } from 'drizzle-orm';
import { fills, wallets, type NewFill } from '@copytrade/db';
import { tryNormalizeAddress } from '@copytrade/shared';
import { db } from '$lib/server/db';
import { hl } from '$lib/server/hl';
import type { RequestHandler } from './$types';

// ── deepen one trader's fills history ────────────────────────────────
//
// POST /api/trader/<addr>/deepen
//
// Pulls historical fills from HL `userFillsByTime` and writes them into
// our `fills` table, then flips `wallets.history_deepened_at` so the
// nightly retention cron skips this wallet.
//
// Concurrency: a pg advisory lock keyed on the address dedupes simultaneous
// clicks. The transaction holding the lock returns the lock's status; if
// another caller already holds it we return 409 with `status: 'in_progress'`.
//
// HL weight: userFillsByTime is `20 + 20 per ~20 items`. A wallet with a
// few thousand fills typically lands at 2–5 pages → ≤120 weight per click.
// 800/min budget → ~6–13 concurrent deepens per minute.
//
// See: docs/plans/2026-05-16-fills-retention-and-deepen.md

// HL's published history horizon is ~180 days; we go back 365 to be safe
// against future changes and clamp at HL's own limit naturally.
const MAX_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
// Stop after this many pages even if HL keeps returning more — defensive
// cap so a single deep wallet can't burn unbounded weight.
const MAX_PAGES = 50;
// HL's `userFillsByTime` empirically returns up to ~2000 rows per page;
// we treat < 100 as a clean stop signal (page wasn't full).
const STOP_BELOW = 100;

// hashtext is uint32; advisory locks take int8 — fold to signed.
const lockKeyOf = (s: string): bigint => BigInt.asIntN(64, BigInt(hashCode(s)));
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export const POST: RequestHandler = async ({ params }) => {
  const address = tryNormalizeAddress(params.address);
  if (!address) throw error(400, 'Invalid address');

  // Try to acquire the advisory lock. If we don't get it, someone else is
  // already deepening this wallet; let them finish.
  const lockKey = lockKeyOf('deepen:' + address);
  const lockRes = await db().execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_lock(${lockKey.toString()}::bigint) AS acquired`,
  );
  if (lockRes.rows[0]?.acquired !== true) {
    return json({ status: 'in_progress' }, { status: 409 });
  }

  try {
    // Walk forward from MAX_LOOKBACK_MS until HL returns a non-full page.
    // ingest-wallet uses the same forward-cursor pattern (see
    // `pageUserFillsByTime` in apps/worker/src/services/ingest-wallet.ts).
    const startedAt = Date.now();
    let cursor = Math.max(0, Date.now() - MAX_LOOKBACK_MS);
    const nowMs = Date.now();
    let pages = 0;
    let inserted = 0;
    let oldestMs = Number.POSITIVE_INFINITY;
    let newestMs = 0;

    for (let i = 0; i < MAX_PAGES; i++) {
      const resp = await hl().userFillsByTime(address, cursor, nowMs);
      pages += 1;
      if (resp.data.length === 0) break;

      const rows: NewFill[] = resp.data.map((f) => ({
        tid: f.tid,
        userAddress: address,
        blockTimeMs: f.time,
        coin: f.coin,
        side: f.side,
        px: f.px,
        sz: f.sz,
        fee: f.fee,
        feeToken: f.feeToken,
        builderFee: f.builderFee ?? '0',
        oid: f.oid,
        hash: f.hash,
        crossed: f.crossed,
        closedPnl: f.closedPnl,
        startPosition: f.startPosition,
        liquidationUser: f.liquidation?.liquidatedUser ?? null,
        createdAt: new Date(),
      }));

      // onConflictDoUpdate so we enrich any sentinel rows the firehose
      // wrote (fee=0, closedPnl=0) — same contract as ingest-wallet.
      for (let j = 0; j < rows.length; j += 200) {
        await db()
          .insert(fills)
          .values(rows.slice(j, j + 200))
          .onConflictDoUpdate({
            target: [fills.tid, fills.userAddress],
            set: {
              fee: sql`excluded.fee`,
              feeToken: sql`excluded.fee_token`,
              builderFee: sql`excluded.builder_fee`,
              oid: sql`excluded.oid`,
              crossed: sql`excluded.crossed`,
              closedPnl: sql`excluded.closed_pnl`,
              startPosition: sql`excluded.start_position`,
              liquidationUser: sql`excluded.liquidation_user`,
            },
          });
      }
      inserted += rows.length;

      let pageMax = 0;
      for (const r of rows) {
        if (r.blockTimeMs > pageMax) pageMax = r.blockTimeMs;
        if (r.blockTimeMs < oldestMs) oldestMs = r.blockTimeMs;
        if (r.blockTimeMs > newestMs) newestMs = r.blockTimeMs;
      }
      if (rows.length < STOP_BELOW) break;
      cursor = pageMax + 1;
      if (cursor >= nowMs) break;
    }

    // Mark deepened so the retention cron skips this wallet from now on,
    // and record the oldest fill ms we now have (for the UI badge). If we
    // inserted zero fills (HL had nothing), still mark deepened so the
    // button doesn't show again — the answer was "no history available."
    await db()
      .update(wallets)
      .set({
        historyDeepenedAt: new Date(),
        historyOldestMs: Number.isFinite(oldestMs) ? oldestMs : null,
        updatedAt: new Date(),
      })
      .where(eq(wallets.address, address));

    return json({
      status: 'ok',
      pages,
      inserted,
      oldestMs: Number.isFinite(oldestMs) ? oldestMs : null,
      newestMs: newestMs || null,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    await db().execute(
      sql`SELECT pg_advisory_unlock(${lockKey.toString()}::bigint)`,
    );
  }
};
