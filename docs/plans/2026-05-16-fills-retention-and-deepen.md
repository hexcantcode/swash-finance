# Fills retention + on-demand deep-history

**Status:** spec, pre-implementation.
**Date:** 2026-05-16.

## Problem

`fills` is the only unbounded-growth table we own. The per-coin firehose
writes ~1.3 k rows/min (~1.9 M/day) and the table sat at 403 MB this
morning before a manual `DELETE > 30d` + `VACUUM FULL` brought the Neon
free-tier project from 490/512 MB back to 274/512 MB. With the firehose
running it climbs ~150-200 MB/day. Without an automated retention story
we re-hit the ceiling on every Neon tier we move to, just on a longer
timeline.

The shape we want:

- `fills` stays bounded *forever*, regardless of HL volume.
- The user-visible "All-Time PnL / Volume" numbers stay accurate.
- Power users can opt into deep history per trader without dragging the
  whole table back to billions of rows.

## Design

### Two history zones

**Hot zone — last 90 days, always present.**
Written by the firehose + REST polls + WS-live (when re-enabled). Nightly
retention cron deletes any row older than 90 days *unless* the wallet
has been deepened (see below). Powers everything analytics + ticker +
scoring naturally do.

**Deep zone — opt-in per wallet.**
A user clicks "Show all history" on a trader profile. The server
backfills that wallet via HL `userFillsByTime` going back as far as HL
will return (typically ~180 days), writes those rows into the same
`fills` table, and marks the wallet so the retention cron skips it from
that point on. Survives until the user (or an admin) explicitly drops it.

### Schema

Two columns on `wallets`:

```ts
historyDeepenedAt: timestamp('history_deepened_at', { withTimezone: true }),
// Earliest `block_time_ms` we currently have stored for this wallet. Lets
// the UI render "showing X days" without scanning fills.
historyOldestMs: bigint('history_oldest_ms', { mode: 'number' }),
```

No other table touched. (`scores` *could* gain a "scored-with-deep-history"
flag later if we want to badge that on profiles; not needed for v1.)

### Retention cron

New job `fills-retention`, scheduled nightly at 02:30 (after the existing
`score` cron at 02:00 so the day's scores see the fuller table):

```sql
DELETE FROM fills f
USING wallets w
WHERE f.user_address = w.address
  AND w.history_deepened_at IS NULL
  AND f.block_time_ms < (extract(epoch from now()) * 1000)::bigint
                        - 90 * 86400 * 1000;
```

Followed by `VACUUM (ANALYZE) fills`. Deepened wallets are skipped
entirely. A wallet's deepened state can be dropped later via an admin
script that clears `history_deepened_at` and the next nightly run
trims it back to 90 days.

Wired into `apps/worker/src/cli.ts` as `fills-retention` and added to
the cron worker (`apps/worker/src/index.ts`) with `0 30 2 * * *`.

### Deepen API

`POST /api/trader/<address>/deepen` (server endpoint in
`apps/web/src/routes/api/trader/[address]/deepen/+server.ts`):

1. Validate `address`; 400 on bad input.
2. Advisory-lock keyed on `address` to dedupe concurrent clicks
   (`SELECT pg_try_advisory_xact_lock(hashtext('deepen:' || $1))`).
   Locked → return 409 with `{ status: 'already_running' }`.
3. Loop `hl().userFillsByTime(address, { startTime: cursor })` until:
   - response is empty, OR
   - HL returns no fills older than the previous cursor (no more history), OR
   - row count this call < page size (last page).
4. Each page → `INSERT INTO fills … ON CONFLICT DO NOTHING` so we don't
   double-write rows the firehose already captured.
5. On success: `UPDATE wallets SET history_deepened_at = now(),
   history_oldest_ms = (min written ms for this wallet)`.
6. Optionally: kick off a single-wallet score recompute so the deeper
   sample reflects in the displayed Sharpe / win-rate / etc. Can be
   sync (small latency cost) or queued.

Cost: HL weight `20 base + 20 per page (2000 rows)`. Typical active
trader: 2-5 pages → 60-120 weight per click. Our budget is 800/min,
so the page can absorb ~6-13 concurrent deepens per minute without
backpressure. If hit, return 503 and let the client retry.

### Trader-profile UI

On `/trader/[address]`, the loader exposes `historyDeepenedAt` and
`historyOldestMs` to the page. Two new visible elements on the chart
section:

- **Badge** when not deepened and the chart window selector is at "All":
  `"Last 90 days · click Show all history to extend"`.
- **Button** in the chart-controls row: `"Show all history"`. Disabled
  if `historyDeepenedAt IS NOT NULL`. On click, POSTs to deepen, shows
  spinner, reloads on 200.

No change to the 24H/7D/30D/ALL pills — when "ALL" is selected for a
non-deepened wallet, it just shows what's in the DB (= 90 days) with
the badge above to explain. We don't lie about "all-time" coverage.

### What this doesn't change

- Scoring still operates on `fills` directly. For non-deepened wallets
  scores reflect 90 days; for deepened wallets they reflect whatever HL
  returned. We already compute `score.total_trades` /
  `total_volume_usd` / `net_pnl_usd` against the current table — those
  numbers stay self-consistent within the visible window.
- The ticker, position matrix, leaderboard panels read recent data and
  are unaffected.
- HIP-3 cohort filter (`fills WHERE coin LIKE '%:%'` last 14d) lives
  within the 90-day window — unaffected.
- The other `userFills` REST writers (ws-live's handler,
  ingest-wallet's REST path) already use `onConflictDoUpdate` per
  today's earlier change — they continue to enrich sentinel rows
  written by the firehose, and concurrent deepens won't clobber them.

## Risks & edge cases

1. **Deepen on a brand-new wallet (no fills yet).** HL returns empty
   pages; we still set `history_deepened_at` so retention skips them
   going forward. Fine.
2. **Deepen during firehose write.** Both write to `fills` with
   `ON CONFLICT DO NOTHING` on `(tid, user_address)` — collisions are
   silent dedupes, not errors.
3. **Wallet has > HL's hard limit of fills (~180 days, ~thousands of
   pages).** Cap the loop at e.g. 50 pages (~100 k fills) per request
   to bound HL weight. If a trader is *that* prolific, 100 k recent
   fills is still 10× more than analytics needs.
4. **Race: two clicks in quick succession.** Advisory lock dedupes.
5. **Deepen on a wallet with sentinel rows from the firehose.** REST
   `userFills` returns real fee/closedPnl/oid; ON CONFLICT DO UPDATE
   in the deepen writer enriches sentinel rows just like
   `ingest-wallet` and `ws-live`'s userFills handler do today.
6. **Drift: deepened wallet stops being interesting and we don't want
   its history forever.** Admin can `UPDATE wallets SET
   history_deepened_at = NULL WHERE address = '0x…'`; the next
   retention run trims it back to 90 days. Cheap escape hatch.

## Migration drift caveat

Per `CLAUDE.md` we cannot run `db:migrate` / `db:generate` / `db:push`
from `main` until the data-sources branch lands. Two columns on
`wallets` are tiny; safest path:

```sql
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS history_deepened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_oldest_ms   BIGINT;
```

Run via the Neon console or a one-off `psql`, mirror the columns in
`packages/db/src/schema.ts` for type safety, and document this as
another "applied out of band" item alongside the `calmar`/`dsr`
stopgap. Doesn't make the drift worse — both columns are nullable
additions with no defaults that would conflict on merge with
data-sources.

## Cost model after this lands

- Hot zone steady state: ~6,700 wallets × ~10 fills/day × 90 days =
  ~6 M rows ≈ 1.2 GB raw + indexes ≈ 1.8 GB.
- Deep zone (assume 10% of wallets ever get deepened, ~200 extra days
  on average): ~670 wallets × ~200 days × ~10 fills = ~1.3 M rows ≈
  260 MB.
- Total: **~2-2.5 GB stable.** Well inside Neon Launch (10 GB), with
  room to grow as HL traffic itself grows.

## Implementation order

1. **DDL** (manual via psql or Neon console):
   `ALTER TABLE wallets ADD COLUMN ...` × 2.
2. **Drizzle schema mirror** — add the two columns to
   `packages/db/src/schema.ts`.
3. **Retention job** — `apps/worker/src/jobs/fills-retention.ts` plus
   CLI entry in `cli.ts` and a cron in `index.ts`.
4. **Deepen endpoint** — `+server.ts` under
   `apps/web/src/routes/api/trader/[address]/deepen/`.
5. **Leader-detail loader** — surface `historyDeepenedAt` and
   `historyOldestMs` to the page.
6. **Trader-profile UI** — badge + button in the chart-controls row;
   POST with spinner + reload on success.
7. **Smoke test**: deepen a known-deep trader, verify rows wrote,
   verify retention cron leaves them alone next night, verify a
   non-deepened wallet gets trimmed.

Estimated effort: ~half a day, mostly schema + retention job; the
UI button is small.

## Open questions

- Should "Show all history" be visible to *anyone* or only to
  authenticated users? (Free button = unbounded HL weight from bots
  scraping every trader. Auth-gated = needs auth flow we don't have
  yet.) Suggest: rate-limit per IP in the endpoint (e.g.,
  ≤ 5 deepens/min) until we have proper auth.
- Should we auto-deepen any wallet that's been promoted to a curated
  set or the home-page leaderboard? Probably yes — silently, on a
  slow drip — but that's a separate cron we can add later.
- Retention window of 90 days: enough for win-rate / Sharpe / Sortino
  sample sizes for low-frequency traders? Worth a quick distribution
  check before locking the number in.
