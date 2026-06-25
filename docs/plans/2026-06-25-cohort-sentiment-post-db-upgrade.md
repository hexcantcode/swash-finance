# Cohort sentiment — post-DB-upgrade tasks

**Status:** Parked, gated on DB capacity upgrade (saved 2026-06-25).

## Context

We built a recorder for Hyperdash cohort sentiment so we can chart how each
PnL cohort's bias moves over time. It shipped **aggregate-only** because the DB
was at **483 MB of its 512 MB cap** (`fills` ≈ 364 MB and growing) — per-market
history at 5-min cadence is ~6 MB/day and would have blown the cap in days.

The DB is being upgraded to a larger tier. Once that lands, the tasks below
finish what capacity blocked. Related but broader: the long-term goal is to drop
Hyperdash entirely and derive sentiment from our own HL pipeline — see
`2026-06-25-hyperdash-independence-migration.md`. Until that lands, these tasks
keep sourcing from Hyperdash.

## Already done this session (no upgrade needed)

- `cohort_sentiment_history` table — migration `0009`. Per snapshot per PnL
  cohort: `captured_at`, `cohort_id`, `long/short_traders`, `long/short_notional`.
  **Aggregate-only**; net/bias is NOT stored (derived by the one canonical
  `biasFor` in `apps/api/.../queries/cohort-sentiment.ts`).
- Worker job `apps/worker/src/jobs/cohort-snapshot.ts` — fetches
  `perpsMarketParticipation`, rolls each cohort up to its long/short aggregate,
  upserts keyed on Hyperdash's snapshot timestamp (idempotent), self-prunes to
  `RETENTION_DAYS = 45`.
- Cron `30 */5 * * * *` + `cohort-snapshot` CLI command.
- Dropped dead `scores.calmar` / `scores.dsr` columns — migration `0010`.

The live Sentiment tab still reads Hyperdash directly (unchanged). The recorder
just accumulates history in parallel; nothing reads it yet.

## Tasks after the DB upgrade

### 1. Per-market EP sentiment history
**Scope decision (2026-06-25): per-market history is Extremely-Profitable ONLY** —
the top "most profitable" cohort, our smart-money signal. We do NOT store
per-market rows for the other five cohorts. (The cohort-level *aggregate* table
from this session keeps all six — that's tiny and powers the cohort-comparison
chart; only the big per-market breakdown is EP-only.)

Extend the snapshot job to also store the per-market breakdown for EP, so we can
chart a single market's smart-money bias over time (e.g. "BTC EP positioning, 7d").

- New table `cohort_market_sentiment_history`, separate from the aggregate table
  to keep the aggregate series clean.
- Columns mirror the raw feed: `captured_at, coin, long/short_traders,
  profitable/losing_traders, long/short_notional`. Still **no derived net/bias**.
  Keep a `cohort_id` column (defaulted to `extremely_profitable`) only if we want
  cheap future-proofing; otherwise omit it since the table is EP-by-definition.
- Filter to markets with ≥ `MIN_TRADERS` (3) to drop dust — same threshold the
  display uses.
- **Storage math (EP-only):** EP ≈ 232 markets, ~150 pass the ≥3 filter. 150 rows
  × 288 snapshots/day ≈ 43k rows/day ≈ ~6 MB/day. Pick retention against the new
  cap (e.g. 30 days ≈ ~180 MB; 60 days ≈ ~360 MB).
- Reuse the exact fetch/parse already in `cohort-snapshot.ts`.

### 2. Switch the API Sentiment tab to read from DB + history endpoint
- Refactor `getCohortSentiment()` to read the latest snapshot from the DB instead
  of proxying Hyperdash live. Keep `transformParticipation` / `biasFor` as the one
  source of the net/bias derivation — reconstruct the raw cohort shape from DB
  rows and run it through the same transform.
- **Live fallback:** if the latest snapshot is missing or older than ~15 min
  (worker down / local dev), fall back to a direct Hyperdash fetch so the tab
  still works. Share the transform between both paths.
- Add `GET /api/feed/cohort-sentiment/history?cohort=&coin=&window=` reading the
  history tables, and an over-time chart on the Sentiment tab.

### 3. Widen aggregate retention
With headroom, bump `RETENTION_DAYS` on the aggregate table well past 45 (it's
tiny — 6 rows/snapshot ≈ 0.25 MB/day). 180–365 days is cheap.

### 4. Fix the Sentiment vs Positions sample asymmetry
The two tabs measure different populations and currently disagree silently:
- **Sentiment** = the *whole* EP cohort (~600-700 wallets) via the aggregate feed
  (no addresses available).
- **Positions** = the *top 80* EP wallets by PnL (`hyperdash-ep-traders.ts`,
  `ROSTER_SIZE = 80`), fanned out per-wallet (the only way to get named positions
  with size/entry/uPnL).

You can't reconcile them to one number — the aggregate feed has no wallet list,
and you can't list 700 traders' individual positions. **Recommended fix: make
them two honest lenses, not one contradictory number.**

- **(do first, cheap) Relabel** Positions as "Top Extremely-Profitable traders'
  positions" (a named leaderboard of the biggest smart-money wallets) and
  Sentiment as "EP cohort positioning" (everyone). Removes the "why do these
  disagree?" confusion.
- **(optional) Widen** the Positions roster 80 → ~150 with batching for
  representativeness — never the full cohort (700 HTTP calls/refresh is too heavy
  and rate-limit risky).
- **(optional) Consistent headline:** if the Positions tab shows an aggregate
  long/short bar, drive *that bar* from the cohort-wide participation feed so its
  direction matches Sentiment, while the cards stay the named top-N sample.

Decision pending: relabel-only vs. relabel + widen.

## Verification (per CLAUDE.md)
- `pnpm check` + `pnpm build` pass at repo root.
- Migrations hand-authored (`pnpm db:generate` is broken on main — meta snapshots
  stop at 0005; see CLAUDE.md / memory). Add SQL + a `_journal.json` entry, apply
  with `DB_OVER_WS=1 pnpm --filter @copytrade/db migrate`.
- For the API read-switch: grep that net/bias is computed in exactly one place.
